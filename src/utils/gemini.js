const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');

const { getSystemPrompt } = require('./prompts');
const OpenRouterClient = require('./openrouter');

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = ''; // Keep this for history tracking
let conversationHistory = [];
let isInitializingSession = false;

// Session Type Tracking - REMOVED (Always OpenRouter)
let sessionType = 'openrouter';

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

// Reconnection tracking variables
let reconnectionAttempts = 0;
let maxReconnectionAttempts = 3;
let reconnectionDelay = 10000; // 10 seconds between attempts
let lastSessionParams = null;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Conversation management functions
function initializeNewSession() {
    currentSessionId = Date.now().toString();
    currentTranscription = '';
    conversationHistory = [];
    console.log('New conversation session started:', currentSessionId);
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    console.log('Saved conversation turn:', conversationTurn);

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function sendReconnectionContext() {
    if (!global.geminiSessionRef?.current || conversationHistory.length === 0) {
        return;
    }

    if (sessionType === 'openrouter') return; // OpenRouter handles context differently (in request)

    try {
        // Gather all transcriptions from the conversation history
        const transcriptions = conversationHistory
            .map(turn => turn.transcription)
            .filter(transcription => transcription && transcription.trim().length > 0);

        if (transcriptions.length === 0) {
            return;
        }

        // Create the context message
        const contextMessage = `Till now all these questions were asked in the interview, answer the last one please:\n\n${transcriptions.join(
            '\n'
        )}`;

        console.log('Sending reconnection context with', transcriptions.length, 'previous questions');

        // Send the context message to the new session
        await global.geminiSessionRef.current.sendRealtimeInput({
            text: contextMessage,
        });
    } catch (error) {
        console.error('Error sending reconnection context:', error);
    }
}

async function getEnabledTools() {
    const tools = [];

    // Check if Google Search is enabled (default: true)
    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Wait a bit for the renderer to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

async function attemptReconnection() {
    if (!lastSessionParams || reconnectionAttempts >= maxReconnectionAttempts) {
        console.log('Max reconnection attempts reached or no session params stored');
        sendToRenderer('update-status', 'Session closed');
        return false;
    }

    reconnectionAttempts++;
    console.log(`Attempting reconnection ${reconnectionAttempts}/${maxReconnectionAttempts}...`);

    // Wait before attempting reconnection
    await new Promise(resolve => setTimeout(resolve, reconnectionDelay));

    // Check if session params still exist (might have been cleared during delay)
    if (!lastSessionParams) {
        console.log('Session params cleared during reconnection delay - aborting');
        return false;
    }

    try {
        const session = await initializeGeminiSession(
            lastSessionParams.apiKey,
            lastSessionParams.customPrompt,
            lastSessionParams.profile,
            lastSessionParams.language,
            true // isReconnection flag
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;
            reconnectionAttempts = 0; // Reset counter on successful reconnection
            console.log('Live session reconnected');

            // Send context message with previous transcriptions
            await sendReconnectionContext();

            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectionAttempts} failed:`, error);
    }

    // If this attempt failed, try again
    if (reconnectionAttempts < maxReconnectionAttempts) {
        return attemptReconnection();
    } else {
        console.log('All reconnection attempts failed');
        sendToRenderer('update-status', 'Session closed');
        return false;
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnection = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);

    // Detect OpenRouter Key
    if (apiKey.startsWith('sk-or-v1') || apiKey.startsWith('pk-')) {
        sessionType = 'openrouter';
        console.log('Detected OpenRouter API Key. Switching to OpenRouter client.');
    } else {
        sessionType = 'gemini';
    }

    // Store session parameters for reconnection
    if (!isReconnection) {
        lastSessionParams = {
            apiKey,
            customPrompt,
            profile,
            language,
        };
        reconnectionAttempts = 0;
    }

    // Initialize new conversation session
    if (!isReconnection) {
        initializeNewSession();
    }

    try {
        if (sessionType === 'openrouter') {
            const systemPrompt = getSystemPrompt(profile, customPrompt, false); // No google search tool for now in simple OpenRouter implementation

            const client = new OpenRouterClient(apiKey, systemPrompt);

            // Set up callback for streaming tokens to renderer
            client.setOnTokenCallback(token => {
                sendToRenderer('update-response', token);
            });

            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
            sendToRenderer('update-status', 'OpenRouter Connected');

            return client;
        } else {
            // ORIGINAL GEMINI WEBSOCKET LOGIC
            const client = new GoogleGenAI({
                vertexai: false,
                apiKey: apiKey,
            });

            const enabledTools = await getEnabledTools();
            const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);
            const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);

            const session = await client.live.connect({
                model: 'gemini-2.5-pro',
                callbacks: {
                    onopen: function () {
                        sendToRenderer('update-status', 'Live session connected');
                    },
                    onmessage: function (message) {
                        // console.log('----------------', message); // Reduce noise

                        if (message.serverContent?.inputTranscription?.results) {
                            currentTranscription += formatSpeakerResults(message.serverContent.inputTranscription.results);
                        }

                        // Handle AI model response
                        if (message.serverContent?.modelTurn?.parts) {
                            for (const part of message.serverContent.modelTurn.parts) {
                                if (part.text) {
                                    messageBuffer += part.text;
                                    sendToRenderer('update-response', messageBuffer);
                                }
                            }
                        }

                        if (message.serverContent?.generationComplete) {
                            sendToRenderer('update-response', messageBuffer);
                            if (currentTranscription && messageBuffer) {
                                saveConversationTurn(currentTranscription, messageBuffer);
                                currentTranscription = '';
                            }
                            messageBuffer = '';
                        }

                        if (message.serverContent?.turnComplete) {
                            sendToRenderer('update-status', 'Ready');
                        }
                    },
                    onerror: function (e) {
                        console.debug('Error:', e.message);
                        const isApiKeyError = e.message && (e.message.includes('API key') || e.message.includes('authentication'));

                        if (isApiKeyError) {
                            console.log('Error due to invalid API key - stopping reconnection');
                            lastSessionParams = null;
                            reconnectionAttempts = maxReconnectionAttempts;
                            sendToRenderer('update-status', 'Error: Invalid API key');
                            return;
                        }

                        sendToRenderer('update-status', 'Error: ' + e.message);
                    },
                    onclose: function (e) {
                        // Simplify close handling for brevity in this rewrite, same logic as before
                        console.debug('Session closed:', e.reason);
                        if (lastSessionParams && reconnectionAttempts < maxReconnectionAttempts) {
                            console.log('Attempting automatic reconnection...');
                            attemptReconnection();
                        } else {
                            sendToRenderer('update-status', 'Session closed');
                        }
                    },
                },
                config: {
                    responseModalities: ['TEXT'],
                    tools: enabledTools,
                    inputAudioTranscription: {
                        enableSpeakerDiarization: true,
                        minSpeakerCount: 2,
                        maxSpeakerCount: 2,
                    },
                    contextWindowCompression: { slidingWindow: {} },
                    speechConfig: { languageCode: language },
                    systemInstruction: {
                        parts: [{ text: systemPrompt }],
                    },
                },
            });

            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
            return session;
        }
    } catch (error) {
        console.error('Failed to initialize session:', error);
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return null;
    }
}

// Stubs for compatibility with index.js
async function startMacOSAudioCapture() {
    return { success: false };
}
function stopMacOSAudioCapture() {}

async function sendAudioToGemini() {
    return;
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    // Audio handlers are disabled for OpenRouter
    ipcMain.handle('send-audio-content', async () => ({ success: true }));
    ipcMain.handle('send-mic-audio-content', async () => ({ success: true }));

    ipcMain.handle('send-image-content', async (event, { data, debug }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active session' };

        try {
            if (!data || typeof data !== 'string' || data.length < 100) {
                return { success: false, error: 'Invalid image data' };
            }

            process.stdout.write('!');

            // OpenRouter Logic: Send Snapshot
            sendToRenderer('update-response', '');
            sendToRenderer('update-status', 'Analyzing Image...');

            const responseText = await geminiSessionRef.current.sendMessage({
                image: data,
            });

            if (responseText) {
                saveConversationTurn('[Image Upload]', responseText);
            }

            sendToRenderer('update-status', 'Ready');
            return { success: true };
        } catch (error) {
            console.error('Error sending image:', error);
            sendToRenderer('update-status', 'Error: ' + error.message);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active session' };

        try {
            if (!text || !text.trim()) return { success: false, error: 'Invalid text' };

            sendToRenderer('update-status', 'Thinking...');
            const useHistory = await getStoredSetting('useHistory', 'true');
            const responseText = await geminiSessionRef.current.sendMessage({
                text: text.trim(),
                useHistory: useHistory === 'true',
            });

            if (responseText) {
                saveConversationTurn(text.trim(), responseText);
            }
            sendToRenderer('update-status', 'Ready');

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio', async () => ({ success: false }));
    ipcMain.handle('stop-macos-audio', async () => ({ success: true }));

    ipcMain.handle('close-session', async () => {
        lastSessionParams = null;
        if (geminiSessionRef.current) {
            // OpenRouterClient doesn't require explicit closing
            geminiSessionRef.current = null;
        }
        return { success: true };
    });

    ipcMain.handle('send-multimodal-message', async (event, { text, image }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active session' };

        try {
            if (!text || !image) return { success: false, error: 'Missing text or image' };

            sendToRenderer('update-status', 'Analyzing...');
            const useHistory = await getStoredSetting('useHistory', 'true');
            const responseText = await geminiSessionRef.current.sendMessage({
                text: text.trim(),
                image: image,
                useHistory: useHistory === 'true',
            });

            if (responseText) {
                saveConversationTurn(text.trim() + ' [with Image]', responseText);
            }
            sendToRenderer('update-status', 'Ready');

            return { success: true };
        } catch (error) {
            console.error('Multimodal error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-current-session', async () => ({ success: true, data: getCurrentSessionData() }));
    ipcMain.handle('start-new-session', async () => {
        initializeNewSession();
        return { success: true, sessionId: currentSessionId };
    });

    ipcMain.handle('update-google-search-setting', async () => ({ success: true }));
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    sendReconnectionContext,
    startMacOSAudioCapture,
    stopMacOSAudioCapture,
    setupGeminiIpcHandlers,
    attemptReconnection,
    formatSpeakerResults,
};
