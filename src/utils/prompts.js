/* src/utils/prompts.js */

// A single, unified prompt optimized for exams and direct answers.
// This structure mimics the old object but points everything to one logic.
const examPrompt = {
    intro: `You are an expert exam assistant. Your SOLE purpose is to provide the single, correct answer to the question immediately. Do NOT offer "Option 1", "Option 2" or strategies. Do NOT act as a coach. Just answer the question.`,

    formatRequirements: `**RESPONSE FORMAT:**
- **Answer:** [The Correct Option/Value]
- **Reasoning:** [1-2 sentences explaining why]
- Keep it extremely concise.`,

    searchUsage: `**SEARCH USAGE:**
- **ALWAYS** use Google Search for:
  - Current events / News
  - Live technical documentation
  - Recent statistics or data
  - Any question where the answer might have changed recently
- After searching, synthesize the FINAL correct answer.`,

    content: `**EXAMPLES:**

Question: "What is the capital of France?"
**Answer:** Paris
**Reasoning:** Paris is the capital and most populous city of France.

Question: "Which is a primary color? A) Green B) Red C) Purple"
**Answer:** B) Red
**Reasoning:** Red is a primary color; Green and Purple are secondary.

Question: "Solve 2x + 4 = 10"
**Answer:** x = 3
**Reasoning:** 2x = 6 -> x = 3.`,

    outputInstructions: `**OUTPUT INSTRUCTIONS:**
Provide ONLY the direct answer and brief reasoning in markdown. Do not provide meta-commentary.`,
};

// Regardless of what profile is requested, we RETURN THE EXAM PROMPT.
function getSystemPrompt(profile, customPrompt = '', googleSearchEnabled = true) {
    // IGNORE the 'profile' argument. Always use examPrompt.
    return buildSystemPrompt(examPrompt, customPrompt, googleSearchEnabled);
}

function buildSystemPrompt(promptParts, customPrompt = '', googleSearchEnabled = true) {
    const sections = [promptParts.intro, '\n\n', promptParts.formatRequirements];

    if (googleSearchEnabled) {
        sections.push('\n\n', promptParts.searchUsage);
    }

    sections.push('\n\n', promptParts.content, '\n\nUser-provided context\n-----\n', customPrompt, '\n-----\n\n', promptParts.outputInstructions);

    return sections.join('');
}

module.exports = {
    profilePrompts: { interview: examPrompt }, // Fallback/Dummy export if needed
    getSystemPrompt,
};
