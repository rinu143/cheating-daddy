# NVIDIA Premier

A stealthy, efficient AI assistant designed for interviews, exams, and professional meetings. Powered by **OpenRouter**, it provides intelligent, context-aware responses on command without invasive always-on recording.

<img width="1299" height="424" alt="cd (1)" src="https://github.com/user-attachments/assets/b25fff4d-043d-4f38-9985-f832ae0d0f6e" />

## ✨ Features

-   **Manual AI Analysis**: Trigger screen analysis only when needed using shortcuts (`Ctrl+Enter`). No constant background recording.
-   **OpenRouter Integration**: Defaults to `nvidia/nemotron-nano-12b-v2-vl` (Free) but supports any OpenRouter model.
-   **Stealth Design**:
    -   Randomized process name to blend into Task Manager (e.g., "System Monitor").
    -   Transparent, always-on-top overlay.
    -   Click-through mode for unobtrusive usage.
-   **Conversation Memory**: Toggle context awareness on/off. Keep context for follow-up questions or disable it for independent queries.
-   **Multiple Profiles**: Tailored prompts for Interviews, Exams, Sales Calls, Presentations, and Negotiations.
-   **Customizable**: Add your own custom system prompts to fine-tune the AI's behavior.

## 🚀 Setup

1.  **Get an OpenRouter API Key**: Visit [OpenRouter](https://openrouter.ai/keys).
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Run the App**:
    ```bash
    npm start
    ```
4.  **Build for Production**:
    ```bash
    npm run make
    ```

## 📖 Usage

1.  **Initial Setup**: Launch the app and enter your OpenRouter API key.
2.  **Select Profile**: Choose the mode that fits your scenario (e.g., **Interview** or **Exam**).
3.  **Position Window**: Use the arrow keys (with `Ctrl/Cmd`) to move the overlay to a convenient spot.
4.  **Trigger Analysis**:
    -   **`Ctrl + Enter` (or `Cmd + Enter`)**: Instantly captures the screen, reads the content (text/code/images), and generates an answer.
    -   You can also type a specific question in the input box and press `Ctrl + Enter` to send both the text and screen context.

## ⌨️ Keyboard Shortcuts

| Shortcut                | Action                                       |
| ----------------------- | -------------------------------------------- |
| `Ctrl/Cmd + Enter`      | **Capture & Analyze** (Triggers AI response) |
| `Ctrl/Cmd + Arrow Keys` | Move the window                              |
| `Ctrl/Cmd + M`          | Toggle **Click-through Mode** (Mouse events) |
| `Ctrl/Cmd + \`          | Go Back / Close Window                       |

## 🛠️ Configuration

Access the **Settings** menu to:

-   **Enable/Disable Conversation Memory**: Choose if the AI remembers previous turns.
-   **Change Language**: Set the output language.
-   **Edit Custom Prompts**: Add specific instructions (e.g., "Answer in Python only").

## 🔒 Privacy & Security

-   **No Always-On Recording**: Audio and video are **only** captured when you explicitly trigger the shortcut.
-   **Local Key Storage**: API keys are stored locally on your device.
-   **Stealth Mode**: The application attempts to disguise its presence in the process list.

## 📋 Requirements

-   Windows, macOS, or Linux (Electron-compatible)
-   Active Internet Connection (for API access)
-   OpenRouter API Key
