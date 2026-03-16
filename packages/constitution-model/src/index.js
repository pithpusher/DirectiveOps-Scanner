export const FILE_PRECEDENCE = {
    AGENTS_MD: 70,
    CLAUDE_MD: 60,
    GEMINI_MD: 65,
    COPILOT_INSTRUCTIONS: 80,
    GITHUB_INSTRUCTIONS: 75,
    PROMPT_FILE: 40,
    UNKNOWN: 10
};
export function inferPrecedence(fileType, path) {
    const base = FILE_PRECEDENCE[fileType] ?? FILE_PRECEDENCE.UNKNOWN;
    if (path.startsWith(".github/instructions/")) {
        return base + 5;
    }
    if (path.includes("/prompts/")) {
        return base - 5;
    }
    return base;
}
export function summarizeDirectiveKey(category, normalizedText) {
    return `${category}:${normalizedText.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
export function sortLayersByPrecedence(layers) {
    return [...layers].sort((left, right) => right.precedence - left.precedence);
}
//# sourceMappingURL=index.js.map