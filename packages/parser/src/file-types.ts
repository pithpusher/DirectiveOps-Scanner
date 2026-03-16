import type { InstructionFileType, InstructionScope, ParserKind } from "@directiveops/constitution-model";

export function detectInstructionFileType(path: string): InstructionFileType {
  if (path === "AGENTS.md") {
    return "AGENTS_MD";
  }
  if (path === "CLAUDE.md") {
    return "CLAUDE_MD";
  }
  if (path === "GEMINI.md") {
    return "GEMINI_MD";
  }
  if (path === ".github/copilot-instructions.md") {
    return "COPILOT_INSTRUCTIONS";
  }
  if (path.startsWith(".github/instructions/") && path.endsWith(".instructions.md")) {
    return "GITHUB_INSTRUCTIONS";
  }
  if (path.includes("prompt") || path.includes("instructions")) {
    return "PROMPT_FILE";
  }
  return "UNKNOWN";
}

export function detectParserKind(path: string): ParserKind {
  const fileType = detectInstructionFileType(path);
  switch (fileType) {
    case "AGENTS_MD":
      return "agents-markdown";
    case "CLAUDE_MD":
      return "claude-markdown";
    case "GEMINI_MD":
      return "gemini-markdown";
    case "COPILOT_INSTRUCTIONS":
      return "copilot-markdown";
    default:
      return "generic-markdown";
  }
}

export function inferScope(path: string, explicitScope?: string): InstructionScope {
  if (explicitScope) {
    const normalized = explicitScope.trim().toLowerCase();
    if (normalized === "organization" || normalized === "repository" || normalized === "directory" || normalized === "file" || normalized === "workflow" || normalized === "tool") {
      return normalized;
    }
  }

  if (path === "AGENTS.md" || path === "CLAUDE.md" || path === "GEMINI.md" || path === ".github/copilot-instructions.md") {
    return "repository";
  }
  if (path.startsWith(".github/instructions/")) {
    return "directory";
  }
  if (path.includes("/workflows/")) {
    return "workflow";
  }
  return "unknown";
}

