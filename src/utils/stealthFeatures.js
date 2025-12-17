const { app } = require('electron');
const processNames = require('./processNames');

function applyStealthMeasures(mainWindow) {
    try {
        // Basic stealth
        mainWindow.setSkipTaskbar(true);
        mainWindow.setContentProtection(true);
        if (process.platform === 'darwin') {
            app.dock.hide();
        }
    } catch (e) {
        console.error('Error applying stealth measures:', e);
    }
}

function startTitleRandomization(mainWindow) {
    // Randomize title every 30-60 seconds
    const updateTitle = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        // Use a generic system title if processNames is empty or just pick a random string
        const titles = ['System Host', 'Service Hub', 'Runtime Broker', 'System Idle Process', 'Desktop Window Manager'];

        const randomTitle = titles[Math.floor(Math.random() * titles.length)];
        mainWindow.setTitle(randomTitle);

        // Recurse
        const delay = 30000 + Math.random() * 30000;
        setTimeout(updateTitle, delay);
    };

    updateTitle();
}

// Anti-analysis measures (detecting debugger/VM - stub for now)
function applyAntiAnalysisMeasures() {
    console.log('Applying anti-analysis measures...');
    // Real implementation would go here
}

module.exports = {
    applyStealthMeasures,
    startTitleRandomization,
    applyAntiAnalysisMeasures,
};
