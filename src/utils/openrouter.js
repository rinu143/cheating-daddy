const https = require('https');

class OpenRouterClient {
    constructor(apiKey, systemPrompt = '') {
        this.apiKey = apiKey;
        this.systemPrompt = systemPrompt;
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.model = 'nvidia/nemotron-nano-12b-v2-vl:free'; // Faster, better model
        this.history = []; // Keep a short history for context
    }

    async sendMessage({ text, image, useHistory = true }) {
        // Construct user message
        const userContent = [];

        if (text) {
            userContent.push({ type: 'text', text: text });
        }

        if (image) {
            userContent.push({
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${image}`,
                },
            });
        }

        if (userContent.length > 0) {
            // Prune images from previous messages in history to avoid "at most 10 images" error
            // We want to keep the text history but remove the heavy base64 images from older turns
            this.history.forEach(msg => {
                if (msg.role === 'user' && Array.isArray(msg.content)) {
                    // Filter out image_url parts from previous messages
                    msg.content = msg.content.filter(part => part.type !== 'image_url');
                }
            });

            this.history.push({ role: 'user', content: userContent });
        }

        // Construct full message chain
        const messages = [];

        // Add system prompt if present
        if (this.systemPrompt) {
            messages.push({ role: 'system', content: this.systemPrompt });
        }

        // Add history IS useHistory is enabled
        if (useHistory) {
            messages.push(...this.history);
        } else {
            // If history is disabled, we still need to send the CURRENT message
            // The current message was just added to specific history array, so we can grab the last one
            // OR simpler: just push the last item from history which is the current user message
            if (this.history.length > 0) {
                messages.push(this.history[this.history.length - 1]);
            }
        }

        const responseText = await this.makeRequest(messages);

        // Save assistant response to history
        if (responseText) {
            this.history.push({ role: 'assistant', content: responseText });
        }

        return responseText;
    }

    async makeRequest(messages) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: this.model,
                messages: messages,
                stream: true,
            });

            const options = {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/Antigravity',
                    'X-Title': 'NVIDIA Premier',
                },
            };

            const req = https.request(this.baseUrl, options, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    console.error(`OpenRouter API Error: Status Code ${res.statusCode}`);
                }

                let fullText = '';
                res.setEncoding('utf8');

                res.on('data', chunk => {
                    // ... existing chunk handling
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;
                        if (line.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(line.substring(6));
                                // Check for error object in the stream
                                if (json.error) {
                                    console.error('OpenRouter Stream Error:', json.error);
                                }
                                const content = json.choices?.[0]?.delta?.content || '';
                                if (content) {
                                    fullText += content;
                                    if (this.onToken) this.onToken(fullText);
                                }
                            } catch (e) {
                                console.error('Error parsing SSE:', e);
                            }
                        } else {
                            // Try parsing non-sse error responses
                            try {
                                const json = JSON.parse(line);
                                if (json.error) {
                                    console.error('OpenRouter API Response Error:', json.error);
                                }
                            } catch (e) {}
                        }
                    }
                });

                res.on('end', () => {
                    if (res.statusCode >= 300) {
                        console.error('OpenRouter API Request Failed. Full response:', fullText);
                    }
                    resolve(fullText);
                });
            });

            req.on('error', e => {
                console.error('OpenRouter Connect Error:', e);
                reject(e);
            });

            req.write(data);
            req.end();
        });
    }

    setOnTokenCallback(callback) {
        this.onToken = callback;
    }
}

module.exports = OpenRouterClient;
