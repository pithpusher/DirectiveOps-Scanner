import type { NormalizedInstructionFile } from "@directiveops/constitution-model";
import type { DriftFinding } from "@directiveops/oss-types";

type FindingSeverity = DriftFinding["severity"];

const INSTRUCTION_FILE_TYPES = new Set<NormalizedInstructionFile["fileType"]>([
  "AGENTS_MD",
  "AGENTS_OVERRIDE_MD",
  "CLAUDE_MD",
  "GEMINI_MD",
  "COPILOT_INSTRUCTIONS",
  "GITHUB_INSTRUCTIONS",
  "CURSOR_RULES",
  "WINDSURF_INSTRUCTIONS",
  "GENERIC_AI_INSTRUCTIONS",
  "OPENCLAW_SOUL",
  "OPENCLAW_TOOLS",
  "OPENCLAW_MEMORY",
  "PROMPT_FILE"
]);

const SECRET_PATTERNS: ReadonlyArray<{
  label: string;
  severity: FindingSeverity;
  test: (content: string) => boolean;
}> = [
  {
    label: "AWS access key id (AKIA...)",
    severity: "critical",
    test: (content) => /\bAKIA[0-9A-Z]{16}\b/.test(content)
  },
  {
    label: "GitHub token (gh*_...)",
    severity: "critical",
    test: (content) => /\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(content)
  },
  {
    label: "GitHub fine-grained PAT (github_pat_...)",
    severity: "critical",
    test: (content) => /\bgithub_pat_[a-zA-Z0-9_]{22,}\b/.test(content)
  },
  {
    label: "Slack token (xox...)",
    severity: "critical",
    test: (content) => /\bxox[baprs]-[0-9a-zA-Z-]{8,}\b/.test(content)
  },
  {
    label: "Slack webhook URL",
    severity: "critical",
    test: (content) => /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+/.test(content)
  },
  {
    label: "Stripe secret key",
    severity: "critical",
    test: (content) => /\bsk_live_[0-9a-zA-Z]{20,}\b/.test(content)
  },
  {
    label: "Stripe restricted key",
    severity: "critical",
    test: (content) => /\brk_live_[0-9a-zA-Z]{20,}\b/.test(content)
  },
  {
    label: "PEM or private key block",
    severity: "critical",
    test: (content) => /-----BEGIN (RSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY-----/.test(content)
  },
  {
    label: "OpenAI-style API key (sk-...)",
    severity: "high",
    test: (content) => /\bsk-[a-zA-Z0-9]{32,}\b/.test(content)
  },
  {
    label: "Anthropic API key (sk-ant-...)",
    severity: "critical",
    test: (content) => /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/.test(content)
  },
  {
    label: "Google API key (AIzaSy...)",
    severity: "high",
    test: (content) => /\bAIzaSy[a-zA-Z0-9_-]{33}\b/.test(content)
  },
  {
    label: "JWT token",
    severity: "high",
    test: (content) => /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\b/.test(content)
  },
  {
    label: "Generic API key assignment",
    severity: "high",
    test: (content) =>
      /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key)\s*[:=]\s*["'][a-zA-Z0-9/+=_-]{20,}["']/i.test(content)
  }
];

const UNSAFE_SHELL_PATTERNS: ReadonlyArray<{
  label: string;
  severity: FindingSeverity;
  regex: RegExp;
}> = [
  {
    label: "Remote curl or wget piped to shell",
    severity: "high",
    regex: /curl[^\n`]{0,200}\|\s*(ba)?sh\b/i
  },
  {
    label: "Remote curl piped to source",
    severity: "high",
    regex: /curl[^\n`]{0,200}\|\s*source\b/i
  },
  {
    label: "wget piped to shell",
    severity: "high",
    regex: /wget[^\n`]{0,200}\|\s*(ba)?sh\b/i
  },
  {
    label: "source from process substitution (curl)",
    severity: "high",
    regex: /source\s+<\s*\(\s*curl/i
  },
  {
    label: "eval() execution",
    severity: "medium",
    regex: /\beval\s*\(/i
  },
  {
    label: "chmod 777 (world-writable)",
    severity: "medium",
    regex: /chmod\s+777\b/
  },
  {
    label: "SSL or TLS verification disabled",
    severity: "high",
    regex: /(?:GIT_SSL_NO_VERIFY|NODE_TLS_REJECT_UNAUTHORIZED)\s*=\s*(?:0|false|"0"|"false")/i
  },
  {
    label: "Environment variable dump",
    severity: "medium",
    regex: /\b(?:printenv|env)\s*(?:\||>)/
  }
];

const INVISIBLE_OR_SUSPICIOUS_CHARS = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2060-\u2064]/;
const TAG_CHARACTERS = /[\uE0001-\uE007F]/;

export function scanInstructionFilesForSecurityFindings(options: {
  organizationId: string;
  repositoryId: string;
  sourceFiles: NormalizedInstructionFile[];
  buildFinding: (
    partial: Omit<DriftFinding, "id" | "organizationId" | "repositoryId" | "status">
  ) => DriftFinding;
}): DriftFinding[] {
  const { sourceFiles, buildFinding } = options;
  const findings: DriftFinding[] = [];

  for (const file of sourceFiles) {
    if (!INSTRUCTION_FILE_TYPES.has(file.fileType)) {
      continue;
    }
    const content = file.rawContent;
    if (!content) {
      continue;
    }

    for (const { label, severity, test } of SECRET_PATTERNS) {
      if (test(content)) {
        findings.push(
          buildFinding({
            type: "directive-secret-pattern",
            severity,
            summary: "Possible secret or credential material in an instruction file",
            explanation: `${file.path} may contain ${label}. Instruction files are high-trust inputs read at the start of agent sessions, so secrets should never live here.`,
            affectedFiles: [file.path],
            affectedScope: file.scope,
            suggestedRemediation:
              "Remove secrets from markdown, rotate the credential, and reference environment variables or your secret manager instead."
          })
        );
        break;
      }
    }

    for (const { label, severity, regex } of UNSAFE_SHELL_PATTERNS) {
      if (regex.test(content)) {
        findings.push(
          buildFinding({
            type: "unsafe-directive-pattern",
            severity,
            summary: "Potentially unsafe shell or execution pattern in an instruction file",
            explanation: `${file.path} contains ${label}. Agents may follow these instructions literally; prefer pinned artifacts, checksums, and explicit review for remote execution.`,
            affectedFiles: [file.path],
            affectedScope: file.scope,
            suggestedRemediation:
              "Replace remote pipe-to-shell patterns with explicit, reviewable steps or approved scripts stored in the repository."
          })
        );
        break;
      }
    }

    if (INVISIBLE_OR_SUSPICIOUS_CHARS.test(content)) {
      findings.push(
        buildFinding({
          type: "directive-obfuscation",
          severity: "critical",
          summary: "Invisible or bidirectional Unicode in an instruction file",
          explanation: `${file.path} contains zero-width, format, or bidirectional override Unicode characters. These can hide malicious instructions from human review.`,
          affectedFiles: [file.path],
          affectedScope: file.scope,
          suggestedRemediation: "Strip invisible characters and review the file again before trusting it."
        })
      );
    }

    if (TAG_CHARACTERS.test(content)) {
      findings.push(
        buildFinding({
          type: "directive-obfuscation",
          severity: "high",
          summary: "Tag characters detected in instruction file",
          explanation: `${file.path} contains Unicode tag characters (U+E0001-U+E007F) that are invisible in most editors and can conceal payloads.`,
          affectedFiles: [file.path],
          affectedScope: file.scope,
          suggestedRemediation: "Strip tag characters with a Unicode-aware tool and review the file for hidden content."
        })
      );
    }

    if (detectLlmGeneratedContent(content)) {
      findings.push(
        buildFinding({
          type: "llm-generated-content",
          severity: "low",
          summary: "Instruction file appears to be LLM-generated",
          explanation: `${file.path} exhibits patterns common in LLM-generated content: excessive hedging, overly structured lists, or generic non-repo-specific advice.`,
          affectedFiles: [file.path],
          affectedScope: file.scope,
          suggestedRemediation: "Rewrite this file with repo-specific, actionable instructions and remove generic hedging language."
        })
      );
    }
  }

  return dedupeSecurityFindings(findings);
}

const LLM_HEDGING_PHRASES = [
  "it's important to",
  "make sure to",
  "it is important",
  "consider using",
  "you should consider",
  "best practice is to",
  "it is recommended",
  "please ensure",
  "be sure to",
  "note that"
];

function detectLlmGeneratedContent(content: string): boolean {
  const lower = content.toLowerCase();
  const hedgingCount = LLM_HEDGING_PHRASES.filter((phrase) => lower.includes(phrase)).length;
  const numberedListCount = content.match(/^\d+\.\s/gm)?.length ?? 0;
  const lines = content.split("\n").filter(Boolean);
  const bulletLines = lines.filter((line) => /^\s*[-*]\s/.test(line)).length;
  const bulletRatio = lines.length > 0 ? bulletLines / lines.length : 0;

  if (hedgingCount >= 3) return true;
  if (numberedListCount >= 12) return true;
  if (bulletRatio > 0.7 && hedgingCount >= 2) return true;

  return false;
}

function dedupeSecurityFindings(findings: DriftFinding[]): DriftFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.type}:${finding.affectedFiles.join(",")}:${finding.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
