export type InstructionFileType =
  | "AGENTS_MD"
  | "AGENTS_OVERRIDE_MD"
  | "CLAUDE_MD"
  | "GEMINI_MD"
  | "COPILOT_INSTRUCTIONS"
  | "GITHUB_INSTRUCTIONS"
  | "CURSOR_RULES"
  | "WINDSURF_INSTRUCTIONS"
  | "COPILOT_CONFIG"
  | "NEMOCLAW_POLICY"
  | "NEMOCLAW_INFERENCE_PROFILE"
  | "OPENCLAW_SOUL"
  | "OPENCLAW_TOOLS"
  | "OPENCLAW_MEMORY"
  | "GENERIC_AI_INSTRUCTIONS"
  | "PROMPT_FILE"
  | "UNKNOWN";

export type InstructionScope =
  | "organization"
  | "repository"
  | "directory"
  | "file"
  | "workflow"
  | "tool"
  | "unknown";

export type DirectiveCategory =
  | "testing"
  | "style"
  | "security"
  | "workflow"
  | "documentation"
  | "repo-conventions"
  | "release"
  | "ownership"
  | "quality"
  | "unknown";

export type DirectiveStrength = "must" | "should" | "may" | "avoid" | "unknown";

export type ConstitutionStatus = "draft" | "active" | "superseded" | "archived";

export type ValidationStatus = "valid" | "warning" | "invalid" | "unresolved";

export type ExtractionMethod = "deterministic" | "heuristic";

export type ParserKind =
  | "agents-markdown"
  | "claude-markdown"
  | "gemini-markdown"
  | "copilot-markdown"
  | "cursor-markdown"
  | "windsurf-markdown"
  | "copilot-config"
  | "nemoclaw-policy"
  | "nemoclaw-inference"
  | "openclaw-markdown"
  | "generic-ai-markdown"
  | "generic-markdown";

export interface SourceLocation {
  lineStart: number;
  lineEnd: number;
}

export interface SectionNode {
  id: string;
  heading: string;
  depth: number;
  content: string;
  path: string[];
  location: SourceLocation;
}

export interface InstructionReference {
  target: string;
  targetType: "file" | "url" | "unknown";
  relationship: "imports" | "extends" | "references";
  location: SourceLocation;
  extractionMethod: ExtractionMethod;
  existsInRepository?: boolean;
}

export interface OwnershipReference {
  owner: string;
  kind: "team" | "user" | "unknown";
  extractionMethod: ExtractionMethod;
}

export interface ValidationMessage {
  level: ValidationStatus;
  message: string;
  source: "parser" | "policy";
}

export interface NormalizedDirective {
  id: string;
  key: string;
  rawText: string;
  normalizedText: string;
  category: DirectiveCategory;
  strength: DirectiveStrength;
  scope: InstructionScope;
  tags: string[];
  owners: OwnershipReference[];
  appliesTo: string[];
  extractionMethod: ExtractionMethod;
  confidence: number;
  location: SourceLocation;
  sourceSectionId?: string;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface NormalizedInstructionFile {
  id: string;
  repositoryId: string;
  path: string;
  fileType: InstructionFileType;
  parserKind: ParserKind;
  scope: InstructionScope;
  precedence: number;
  rawContent: string;
  /** Parsed `directiveops` mapping from YAML front matter when present. */
  directiveopsMetadata?: Record<string, unknown>;
  sections: SectionNode[];
  imports: InstructionReference[];
  directives: NormalizedDirective[];
  tags: string[];
  owners: OwnershipReference[];
  validation: ValidationMessage[];
  parserConfidence: number;
  status: ConstitutionStatus;
}

export interface ConstitutionLayer {
  id: string;
  repositoryId: string;
  organizationId: string;
  scope: InstructionScope;
  precedence: number;
  sourceFileIds: string[];
  inheritedLayerIds: string[];
  imports: InstructionReference[];
  directives: NormalizedDirective[];
  tags: string[];
  owners: OwnershipReference[];
  validation: ValidationMessage[];
  status: ConstitutionStatus;
}

export interface ConstitutionGraph {
  constitutionId: string;
  repositoryId: string;
  organizationId: string;
  versionLabel: string;
  layers: ConstitutionLayer[];
  sourceFiles: NormalizedInstructionFile[];
  validation: ValidationMessage[];
  createdAt: string;
}

export interface DirectiveConflict {
  key: string;
  category: DirectiveCategory;
  scope: InstructionScope;
  directiveIds: string[];
  filePaths: string[];
}

export interface ConstitutionDiffPreview {
  repositoryId: string;
  repositoryName: string;
  currentVersionLabel: string;
  targetVersionLabel: string;
  filesToTouch: Array<{
    path: string;
    action: "create" | "update" | "delete";
    summary: string;
  }>;
  findingDelta: {
    resolved: number;
    introduced: number;
    unchanged: number;
  };
}

export const FILE_PRECEDENCE: Record<InstructionFileType, number> = {
  AGENTS_MD: 70,
  AGENTS_OVERRIDE_MD: 72,
  CLAUDE_MD: 60,
  GEMINI_MD: 65,
  COPILOT_INSTRUCTIONS: 80,
  GITHUB_INSTRUCTIONS: 75,
  CURSOR_RULES: 60,
  WINDSURF_INSTRUCTIONS: 60,
  COPILOT_CONFIG: 78,
  NEMOCLAW_POLICY: 68,
  NEMOCLAW_INFERENCE_PROFILE: 55,
  OPENCLAW_SOUL: 62,
  OPENCLAW_TOOLS: 62,
  OPENCLAW_MEMORY: 50,
  GENERIC_AI_INSTRUCTIONS: 45,
  PROMPT_FILE: 40,
  UNKNOWN: 10
};

export function inferPrecedence(fileType: InstructionFileType, path: string): number {
  const base = FILE_PRECEDENCE[fileType] ?? FILE_PRECEDENCE.UNKNOWN;
  if (path.startsWith(".github/instructions/")) {
    return base + 5;
  }
  if (path.includes("/prompts/")) {
    return base - 5;
  }
  return base;
}

export function summarizeDirectiveKey(category: DirectiveCategory, normalizedText: string): string {
  return `${category}:${normalizedText.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function sortLayersByPrecedence(layers: ConstitutionLayer[]): ConstitutionLayer[] {
  return [...layers].sort((left, right) => right.precedence - left.precedence);
}

/* ── Quality scoring types ────────────────────────────────────── */

export type QualityDimensionName =
  | "verbosity"
  | "staleness"
  | "redundancy"
  | "conflict"
  | "consistency"
  | "completeness"
  | "tokenEfficiency";

export interface QualityDimension {
  name: QualityDimensionName;
  /** 0–100 */
  score: number;
  /** Relative weight in composite score (decimal, sums to 1.0 across active dimensions). */
  weight: number;
  /** Human-readable explanations for score deductions. */
  findings: string[];
}

export interface QualityBreakdown {
  dimensions: QualityDimension[];
  compositeScore: number;
}

export type QualityLabel = "excellent" | "good" | "fair" | "needs-work" | "poor";

export interface FileQualityScore {
  filePath: string;
  fileType: InstructionFileType;
  tokenCount: number;
  optimalTokenRange: [number, number];
  qualityBreakdown: QualityBreakdown;
  estimatedMonthlyCostImpact: number;
  label: QualityLabel;
}

export interface RepoQualityScore {
  compositeScore: number;
  fileScores: FileQualityScore[];
  crossToolParityScore: number;
  totalTokens: number;
  estimatedMonthlyCostImpact: number;
  totalFindings: number;
  findingsBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
}
