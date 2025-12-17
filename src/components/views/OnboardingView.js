import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class OnboardingView extends LitElement {
    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100%;
            width: 100%;
            background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
            color: #ffffff;
            font-family: 'Inter', sans-serif;
            text-align: center;
            padding: 20px;
            box-sizing: border-box;
        }

        h1 {
            font-size: 24px;
            margin-bottom: 10px;
            font-weight: 600;
        }

        p {
            font-size: 14px;
            opacity: 0.8;
            margin-bottom: 30px;
            line-height: 1.5;
            max-width: 400px;
        }

        button {
            background: #ffffff;
            color: #000000;
            border: none;
            padding: 12px 24px;
            font-size: 14px;
            font-weight: 600;
            border-radius: 6px;
            cursor: pointer;
            transition: transform 0.1s ease, opacity 0.2s ease;
        }

        button:hover {
            opacity: 0.9;
            transform: scale(1.02);
        }

        button:active {
            transform: scale(0.98);
        }
    `;

    render() {
        return html`
            <h1>Welcome Back</h1>
            <p>Your AI Assistant is ready. Click below to start.</p>
            <button @click=${this.handleComplete}>Get Started</button>
        `;
    }

    handleComplete() {
        // Save state so we don't show this again
        localStorage.setItem('onboardingCompleted', 'true');

        if (this.onComplete) {
            this.onComplete();
        }
    }
}

customElements.define('onboarding-view', OnboardingView);
