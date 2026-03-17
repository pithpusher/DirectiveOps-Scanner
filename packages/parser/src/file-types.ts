import type { InstructionFileType, InstructionScope, ParserKind } from "@directiveops/constitution-model";

export function detectInstructionFileType(path: string): InstructionFileType {
  if (path === "AGENTS.md") return "AGENTS_MD";
  if (path === "CLAUDE.md") return "CLAUDE_MD";
  if (path === "GEMINI.md") return "GEMINI_MD";
  if (path === ".github/copilot-instructions.md") return "COPILOT_INSTRUCTIONS";
  if (path.startsWith(".github/instructions/") && path.endsWith(".instructions.md")) {
    return "GITHUB_INSTRUCTIONS";
  }
  if (path === ".cursor/rules" || path === ".cursor/rules.md") {
    return "CURSOR_RULES";
  }
  if (path.startsWith(".windsurf/") && path.endsWith(".md")) {
    return "WINDSURF_INSTRUCTIONS";
  }
  if (path === ".github/copilot.yaml" || path === "copilot.yaml") {
    return "COPILOT_CONFIG";
  }
  if (path === "nemoclaw.yaml" || path === "nemoclaw.yml") {
    return "NEMOCLAW_POLICY";
  }
  if (path === "openshell-policy.yaml") {
    return "NEMOCLAW_POLICY";
  }
  if (path === "inference-profiles.yaml" || path === "inference-profiles.yml") {
    return "NEMOCLAW_INFERENCE_PROFILE";
  }
  if (path.startsWith("policies/") && path.endsWith(".yaml")) {
    return "NEMOCLAW_POLICY";
  }
  if (path === "SOUL.md") return "OPENCLAW_SOUL";
  if (path === "TOOLS.md") return "OPENCLAW_TOOLS";
  if (path === "MEMORY.md") return "OPENCLAW_MEMORY";
  if (path === "AI.md" || path === "AI-RULES.md") {
    return "GENERIC_AI_INSTRUCTIONS";
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
    case "CURSOR_RULES":
      return "cursor-markdown";
    case "WINDSURF_INSTRUCTIONS":
      return "windsurf-markdown";
    case "COPILOT_CONFIG":
      return "copilot-config";
    case "NEMOCLAW_POLICY":
      return "nemoclaw-policy";
    case "NEMOCLAW_INFERENCE_PROFILE":
      return "nemoclaw-inference";
    case "OPENCLAW_SOUL":
    case "OPENCLAW_TOOLS":
    case "OPENCLAW_MEMORY":
      return "openclaw-markdown";
    case "GENERIC_AI_INSTRUCTIONS":
      return "generic-ai-markdown";
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
  if (path === ".cursor/rules" || path === ".cursor/rules.md") {
    return "repository";
  }
  if (path.startsWith(".windsurf/")) {
    return "repository";
  }
  if (path === ".github/copilot.yaml" || path === "copilot.yaml") {
    return "repository";
  }
  if (path === "nemoclaw.yaml" || path === "nemoclaw.yml" || path === "openshell-policy.yaml") {
    return "tool";
  }
  if (path === "inference-profiles.yaml" || path === "inference-profiles.yml" || path.startsWith("policies/")) {
    return "tool";
  }
  if (path === "SOUL.md" || path === "TOOLS.md" || path === "MEMORY.md" || path === "AI.md" || path === "AI-RULES.md") {
    return "repository";
  }
  if (path.includes("/workflows/")) {
    return "workflow";
  }
  return "unknown";
}

