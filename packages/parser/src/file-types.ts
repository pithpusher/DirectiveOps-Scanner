import type { InstructionFileType, InstructionScope, ParserKind } from "@directiveops/constitution-model";

export interface InstructionFileMatch {
  pattern: RegExp;
  fileType: InstructionFileType;
  parserKind: ParserKind;
  defaultScope: InstructionScope;
}

const INSTRUCTION_FILE_REGISTRY: InstructionFileMatch[] = [
  {
    pattern: /^AGENTS\.md$/,
    fileType: "AGENTS_MD",
    parserKind: "agents-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^AGENTS\.override\.md$/,
    fileType: "AGENTS_OVERRIDE_MD",
    parserKind: "agents-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^CLAUDE\.md$/,
    fileType: "CLAUDE_MD",
    parserKind: "claude-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^GEMINI\.md$/,
    fileType: "GEMINI_MD",
    parserKind: "gemini-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^\.github\/copilot-instructions\.md$/,
    fileType: "COPILOT_INSTRUCTIONS",
    parserKind: "copilot-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^\.github\/instructions\/.+\.instructions\.md$/,
    fileType: "GITHUB_INSTRUCTIONS",
    parserKind: "generic-markdown",
    defaultScope: "directory"
  },
  {
    pattern: /^\.cursor\/rules(\.md)?$/,
    fileType: "CURSOR_RULES",
    parserKind: "cursor-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^\.windsurf\/.+\.md$/,
    fileType: "WINDSURF_INSTRUCTIONS",
    parserKind: "windsurf-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^(\.github\/)?copilot\.yaml$/,
    fileType: "COPILOT_CONFIG",
    parserKind: "copilot-config",
    defaultScope: "repository"
  },
  {
    pattern: /^nemoclaw\.ya?ml$/,
    fileType: "NEMOCLAW_POLICY",
    parserKind: "nemoclaw-policy",
    defaultScope: "tool"
  },
  {
    pattern: /^openshell-policy\.ya?ml$/,
    fileType: "NEMOCLAW_POLICY",
    parserKind: "nemoclaw-policy",
    defaultScope: "tool"
  },
  {
    pattern: /^inference-profiles\.ya?ml$/,
    fileType: "NEMOCLAW_INFERENCE_PROFILE",
    parserKind: "nemoclaw-inference",
    defaultScope: "tool"
  },
  {
    pattern: /^policies\/.+\.ya?ml$/,
    fileType: "NEMOCLAW_POLICY",
    parserKind: "nemoclaw-policy",
    defaultScope: "tool"
  },
  {
    pattern: /^SOUL\.md$/,
    fileType: "OPENCLAW_SOUL",
    parserKind: "openclaw-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^TOOLS\.md$/,
    fileType: "OPENCLAW_TOOLS",
    parserKind: "openclaw-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^MEMORY\.md$/,
    fileType: "OPENCLAW_MEMORY",
    parserKind: "openclaw-markdown",
    defaultScope: "repository"
  },
  {
    pattern: /^AI(-RULES)?\.md$/,
    fileType: "GENERIC_AI_INSTRUCTIONS",
    parserKind: "generic-ai-markdown",
    defaultScope: "repository"
  }
];

export function matchInstructionFile(filePath: string): InstructionFileMatch | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  return INSTRUCTION_FILE_REGISTRY.find((entry) => entry.pattern.test(normalized));
}

export function detectInstructionFileType(filePath: string): InstructionFileType {
  const matched = matchInstructionFile(filePath);
  if (matched) {
    return matched.fileType;
  }
  if (filePath.includes("prompt") || filePath.includes("instructions")) {
    return "PROMPT_FILE";
  }
  return "UNKNOWN";
}

export function detectParserKind(filePath: string): ParserKind {
  const matched = matchInstructionFile(filePath);
  if (matched) {
    return matched.parserKind;
  }
  return "generic-markdown";
}

export function inferScope(filePath: string, explicitScope?: string): InstructionScope {
  if (explicitScope) {
    const normalized = explicitScope.trim().toLowerCase();
    if (
      normalized === "organization" ||
      normalized === "repository" ||
      normalized === "directory" ||
      normalized === "file" ||
      normalized === "workflow" ||
      normalized === "tool"
    ) {
      return normalized;
    }
  }

  const matched = matchInstructionFile(filePath);
  if (matched) {
    return matched.defaultScope;
  }
  if (filePath.includes("/workflows/")) {
    return "workflow";
  }
  return "unknown";
}
