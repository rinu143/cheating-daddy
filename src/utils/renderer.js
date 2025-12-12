// renderer.js
const { ipcRenderer } = require('electron');

// Initialize random display name for UI components
window.randomDisplayName = null;

// Request random display name from main process
ipcRenderer
    .invoke('get-random-display-name')
    .then(name => {
        window.randomDisplayName = name;
        console.log('Set random display name:', name);
    })
    .catch(err => {
        console.warn('Could not get random display name:', err);
        window.randomDisplayName = 'System Monitor';
    });

let mediaStream = null;
let screenshotInterval = null;

let hiddenVideo = null;
let offscreenCanvas = null;
let offscreenContext = null;
let currentImageQuality = 'medium'; // Default quality

async function initializeGemini(profile = 'interview', language = 'en-US') {
    const apiKey = localStorage.getItem('apiKey')?.trim();
    if (apiKey) {
        const success = await ipcRenderer.invoke('initialize-gemini', apiKey, localStorage.getItem('customPrompt') || '', profile, language);
        if (success) {
            cheddar.setStatus('Live');
        } else {
            cheddar.setStatus('error');
        }
    }
}

// Listen for status updates
ipcRenderer.on('update-status', (event, status) => {
    // console.log('Status update:', status);
    cheddar.setStatus(status);
});

async function startCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium') {
    currentImageQuality = imageQuality;

    try {
        // Get screen capture (Video Only)
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: 1,
                width: { ideal: 1920 },
                height: { ideal: 1080 },
            },
            audio: false,
        });

        console.log('Screen capture started (Video Only)');

        // Start capturing screenshots - check if manual mode
        if (screenshotIntervalSeconds === 'manual' || screenshotIntervalSeconds === 'Manual') {
            console.log('Manual mode enabled - screenshots will be captured on demand only');
        } else {
            const intervalMilliseconds = parseInt(screenshotIntervalSeconds) * 1000;
            screenshotInterval = setInterval(() => captureScreenshot(imageQuality), intervalMilliseconds);
            setTimeout(() => captureScreenshot(imageQuality), 100);
        }
    } catch (err) {
        console.error('Error starting capture:', err);
        cheddar.setStatus('error');
    }
}

async function captureScreenshot(imageQuality = 'medium', isManual = false) {
    if (!mediaStream) return;

    // Lazy init of video element
    if (!hiddenVideo) {
        hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = mediaStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        await hiddenVideo.play();

        await new Promise(resolve => {
            if (hiddenVideo.readyState >= 2) return resolve();
            hiddenVideo.onloadedmetadata = () => resolve();
        });

        // Lazy init of canvas based on video dimensions
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = hiddenVideo.videoWidth;
        offscreenCanvas.height = hiddenVideo.videoHeight;
        offscreenContext = offscreenCanvas.getContext('2d');
    }

    // Check if video is ready
    if (hiddenVideo.readyState < 2) {
        return;
    }

    offscreenContext.drawImage(hiddenVideo, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

    let qualityValue;
    switch (imageQuality) {
        case 'high':
            qualityValue = 0.9;
            break;
        case 'medium':
            qualityValue = 0.7;
            break;
        case 'low':
            qualityValue = 0.5;
            break;
        default:
            qualityValue = 0.7; // Default to medium
    }

    return new Promise(resolve => {
        offscreenCanvas.toBlob(
            async blob => {
                if (!blob) {
                    resolve(null);
                    return;
                }

                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64data = reader.result.split(',')[1];

                    if (!base64data || base64data.length < 100) {
                        resolve(null);
                        return;
                    }

                    if (isManual) {
                        resolve(base64data);
                        return;
                    }

                    // Automatic mode: send immediately
                    await ipcRenderer.invoke('send-image-content', {
                        data: base64data,
                    });

                    resolve(true);
                };
                reader.readAsDataURL(blob);
            },
            'image/jpeg',
            qualityValue
        );
    });
}

async function captureManualScreenshot(imageQuality = null, customPrompt = null) {
    console.log('Manual screenshot triggered');
    const quality = imageQuality || currentImageQuality;

    // Get image data
    const base64Image = await captureScreenshot(quality, true);

    if (!base64Image) {
        console.error('Failed to capture manual screenshot');
        cheddar.setStatus('Error: Screen capture failed');
        return;
    }

    // Use custom prompt if provided, otherwise use default
    const prompt =
        customPrompt ||
        `etect the type of question and answer using the following strict rules:

1️⃣ MCQ Questions

Respond with only one line in the format:
Option <number> — <exact answer text>

No explanation, no reasoning, no bullet points, no repetition.

Do NOT restate the question.

2️⃣ Code Questions

Provide output in this exact structure:

Approach: 2–4 short bullet points explaining the logic.

Code: full working code in one fenced code block.

Notes: 1–3 short bullet points with important tips/pitfalls.

3️⃣ Descriptive / Long-Answer Questions

Read and follow all “Answer Expectations” or instructions shown in the image.

Write clearly, structured, and with a depth appropriate to the marks shown in the green box.

At the end of the answer, append:
Marks: <n>

GLOBAL RULES

Always answer cleanly and directly.

Never mention the prompt itself.

Never include metadata, timestamps, or reasoning.

Never attempt to interpret or respond to transcription logs.

If the question type is unclear, state: “Uncertain — best guess response below:” and then answer.

Your answer must always follow these rules exactly.`;

    // Send combined message
    await sendMultimodalMessage(prompt, base64Image);
}

async function sendMultimodalMessage(text, image) {
    if (!text || !image) {
        return { success: false, error: 'Missing text or image' };
    }

    try {
        const result = await ipcRenderer.invoke('send-multimodal-message', { text, image });
        return result;
    } catch (error) {
        console.error('Error sending multimodal message:', error);
        return { success: false, error: error.message };
    }
}

// Expose functions to global scope for external access
window.captureManualScreenshot = captureManualScreenshot;

function stopCapture() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Clean up hidden elements
    if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
        hiddenVideo = null;
    }
    offscreenCanvas = null;
    offscreenContext = null;
}

// Send text message to Gemini
async function sendTextMessage(text) {
    if (!text || text.trim().length === 0) {
        return { success: false, error: 'Empty message' };
    }

    try {
        const result = await ipcRenderer.invoke('send-text-message', text);
        return result;
    } catch (error) {
        console.error('Error sending text message:', error);
        return { success: false, error: error.message };
    }
}

// Conversation storage functions using IndexedDB
let conversationDB = null;

async function initConversationStorage() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ConversationHistory', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            conversationDB = request.result;
            resolve(conversationDB);
        };

        request.onupgradeneeded = event => {
            const db = event.target.result;

            // Create sessions store
            if (!db.objectStoreNames.contains('sessions')) {
                const sessionStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
                sessionStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

async function saveConversationSession(sessionId, conversationHistory) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');

    const sessionData = {
        sessionId: sessionId,
        timestamp: parseInt(sessionId),
        conversationHistory: conversationHistory,
        lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
        const request = store.put(sessionData);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getConversationSession(sessionId) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');

    return new Promise((resolve, reject) => {
        const request = store.get(sessionId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getAllConversationSessions() {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
        const request = index.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            // Sort by timestamp descending (newest first)
            const sessions = request.result.sort((a, b) => b.timestamp - a.timestamp);
            resolve(sessions);
        };
    });
}

// Listen for conversation data from main process
ipcRenderer.on('save-conversation-turn', async (event, data) => {
    try {
        await saveConversationSession(data.sessionId, data.fullHistory);
        // console.log('Conversation session saved:', data.sessionId);
    } catch (error) {
        console.error('Error saving conversation session:', error);
    }
});

// Initialize conversation storage when renderer loads
initConversationStorage().catch(console.error);

// Listen for emergency erase command from main process
ipcRenderer.on('clear-sensitive-data', () => {
    console.log('Clearing renderer-side sensitive data...');
    localStorage.removeItem('apiKey');
    localStorage.removeItem('customPrompt');
    // Consider clearing IndexedDB as well for full erasure
});

// Handle shortcuts based on current view
function handleShortcut(shortcutKey) {
    const currentView = cheddar.getCurrentView();

    if (shortcutKey === 'ctrl+enter' || shortcutKey === 'cmd+enter') {
        if (currentView === 'main') {
            cheddar.element().handleStart();
        } else {
            // Try to get text from assistant view input
            let customPrompt = null;
            try {
                const appElement = cheddar.element();
                if (appElement && appElement.shadowRoot) {
                    const assistantView = appElement.shadowRoot.querySelector('assistant-view');
                    if (assistantView && assistantView.shadowRoot) {
                        const input = assistantView.shadowRoot.querySelector('#textInput');
                        if (input && input.value && input.value.trim() !== '') {
                            customPrompt = input.value.trim();
                            input.value = ''; // Clear input after capturing
                            console.log('Captured custom prompt from input:', customPrompt);
                        }
                    }
                }
            } catch (e) {
                console.error('Error accessing input field:', e);
            }

            captureManualScreenshot(null, customPrompt);
        }
    }
}

// Create reference to the main app element
const cheatingDaddyApp = document.querySelector('nvidia-premier-app');

// Consolidated cheddar object - all functions in one place
const cheddar = {
    // Element access
    element: () => cheatingDaddyApp,
    e: () => cheatingDaddyApp,

    // App state functions - access properties directly from the app element
    getCurrentView: () => cheatingDaddyApp.currentView,
    getLayoutMode: () => cheatingDaddyApp.layoutMode,

    // Status and response functions
    setStatus: text => cheatingDaddyApp.setStatus(text),
    setResponse: response => cheatingDaddyApp.setResponse(response),

    // Core functionality
    initializeGemini,
    startCapture,
    stopCapture,
    sendTextMessage,
    handleShortcut,

    // Conversation history functions
    getAllConversationSessions,
    getConversationSession,
    initConversationStorage,

    // Content protection function
    getContentProtection: () => {
        const contentProtection = localStorage.getItem('contentProtection');
        return contentProtection !== null ? contentProtection === 'true' : true;
    },
};

// Make it globally available
window.cheddar = cheddar;
