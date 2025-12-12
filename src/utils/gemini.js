const { BrowserWindow, ipcMain } = require('electron');
const { getSystemPrompt } = require('./prompts');
const OpenRouterClient = require('./openrouter');

// Conversation tracking variables
let currentSessionId = null;
let conversationHistory = [];
let isInitializingSession = false;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Conversation management functions
function initializeNewSession() {
    currentSessionId = Date.now().toString();
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
    // console.log('Saved conversation turn:', conversationTurn);

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

// Helper to get tools (only Google Search currently relevant for prompt context)
async function getEnabledTools() {
    return []; // No actual tools supported in OpenRouter implementation yet
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
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        return stored || '${defaultValue}';
                    } catch (e) {
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        // console.error('Error getting stored setting for', key, ':', error.message);
    }
    return defaultValue;
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US') {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);

    // Initialize new conversation session
    initializeNewSession();

    try {
        // Build system prompt - strictly OpenRouter now
        const systemPrompt = getSystemPrompt(profile, customPrompt, false);
        const client = new OpenRouterClient(apiKey, systemPrompt);

        // Set up callback for streaming tokens to renderer
        client.setOnTokenCallback(token => {
            sendToRenderer('update-response', token);
        });

        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'OpenRouter Connected');

        return client;
    } catch (error) {
        console.error('Failed to initialize session:', error);
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Error: ' + error.message);
        return null;
    }
}

// Stubs for compatibility
async function startMacOSAudioCapture() {
    return { success: false };
}
function stopMacOSAudioCapture() {}

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

    // Audio handlers - disabled
    ipcMain.handle('send-audio-content', async () => ({ success: true }));
    ipcMain.handle('send-mic-audio-content', async () => ({ success: true }));

    ipcMain.handle('send-image-content', async (event, { data }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active session' };

        try {
            if (!data || typeof data !== 'string' || data.length < 100) {
                return { success: false, error: 'Invalid image data' };
            }

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
        if (geminiSessionRef.current) {
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
    startMacOSAudioCapture,
    stopMacOSAudioCapture,
    setupGeminiIpcHandlers,
};
