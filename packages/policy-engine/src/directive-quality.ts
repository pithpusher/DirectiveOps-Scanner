import type { NormalizedInstructionFile } from "@directiveops/constitution-model";
import type { DriftFinding } from "@directiveops/oss-types";

const SCANNED_TYPES = new Set<NormalizedInstructionFile["fileType"]>([
  "AGENTS_MD",
  "AGENTS_OVERRIDE_MD",
  "CLAUDE_MD",
  "GEMINI_MD",
  "COPILOT_INSTRUCTIONS",
  "GITHUB_INSTRUCTIONS",
  "CURSOR_RULES",
  "GENERIC_AI_INSTRUCTIONS",
  "PROMPT_FILE"
]);

const LARGE_DIRECTIVE_THRESHOLD_CHARS = 12_000;

export function scanInstructionFilesForQualityFindings(options: {
  sourceFiles: NormalizedInstructionFile[];
  buildFinding: (
    partial: Omit<DriftFinding, "id" | "organizationId" | "repositoryId" | "status">
  ) => DriftFinding;
}): DriftFinding[] {
  const { sourceFiles, buildFinding } = options;
  const findings: DriftFinding[] = [];

  for (const file of sourceFiles) {
    if (!SCANNED_TYPES.has(file.fileType)) {
      continue;
    }
    const length = file.rawContent?.length ?? 0;
    if (length < LARGE_DIRECTIVE_THRESHOLD_CHARS) {
      continue;
    }

    findings.push(
      buildFinding({
        type: "directive-quality-budget",
        severity: "medium",
        summary: "Instruction file is very large relative to typical directive budgets",
        explanation: `${file.path} is about ${length.toLocaleString()} characters. Very long instruction files can increase token cost and make execution less reliable. Consider splitting, scoping, or pruning this file to the minimum useful rules.`,
        affectedFiles: [file.path],
        affectedScope: file.scope,
        suggestedRemediation:
          "Reduce scope per file, move reference material to linked docs, and keep only imperative, testable rules in the directive."
      })
    );
  }

  return findings;
}
