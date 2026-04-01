import type {
  ConstitutionGraph,
  DirectiveCategory,
  FileQualityScore,
  InstructionFileType,
  NormalizedInstructionFile,
  QualityDimension,
  QualityLabel,
  RepoQualityScore
} from "@directiveops/constitution-model";
import type { DriftFinding } from "@directiveops/oss-types";

export interface RepoQualityContext {
  hasTests: boolean;
  hasCI: boolean;
  hasSecurityCode: boolean;
  packageJson: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
}

const OPTIMAL_TOKEN_RANGE: Partial<Record<InstructionFileType, [number, number]>> = {
  AGENTS_MD: [500, 1500],
  AGENTS_OVERRIDE_MD: [200, 800],
  CLAUDE_MD: [300, 1000],
  GEMINI_MD: [300, 1000],
  COPILOT_INSTRUCTIONS: [300, 1000],
  GITHUB_INSTRUCTIONS: [200, 800],
  CURSOR_RULES: [200, 800],
  WINDSURF_INSTRUCTIONS: [200, 800]
};

const DEFAULT_OPTIMAL_RANGE: [number, number] = [300, 1200];

function approximateTokenCount(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 1.3);
}

const DIMENSION_WEIGHTS = {
  verbosity: 0.2,
  staleness: 0.25,
  redundancy: 0,
  conflict: 0.2,
  consistency: 0.15,
  completeness: 0.1,
  tokenEfficiency: 0.1
} as const;

export function scoreVerbosity(file: NormalizedInstructionFile): QualityDimension {
  const tokenCount = approximateTokenCount(file.rawContent);
  const [lower, upper] = OPTIMAL_TOKEN_RANGE[file.fileType] ?? DEFAULT_OPTIMAL_RANGE;
  const findings: string[] = [];
  let score: number;

  if (tokenCount >= lower && tokenCount <= upper) {
    score = 100;
  } else if (tokenCount < lower) {
    score = Math.max(60, 100 - Math.round(((lower - tokenCount) / lower) * 40));
    findings.push(`${file.path} is ${lower - tokenCount} tokens below the optimal range (${lower}-${upper})`);
  } else {
    const excess = tokenCount - upper;
    const severe = tokenCount > upper * 3;
    score = severe
      ? Math.max(0, 30 - Math.round((excess / upper) * 10))
      : Math.max(30, 100 - Math.round((excess / upper) * 70));
    findings.push(`${file.path} is ${excess} tokens over the optimal range (${lower}-${upper})`);
  }

  return { name: "verbosity", score: clamp(score), weight: DIMENSION_WEIGHTS.verbosity, findings };
}

export function scoreStaleness(file: NormalizedInstructionFile, staleFindings: DriftFinding[]): QualityDimension {
  const fileStaleFindings = staleFindings.filter(
    (finding) => finding.type === "stale-reference" && finding.affectedFiles.includes(file.path)
  );
  const totalRefs = file.imports.length + file.directives.filter((directive) => directive.tags.includes("references-path")).length;
  const findings: string[] = [];

  if (totalRefs === 0) {
    return { name: "staleness", score: 100, weight: DIMENSION_WEIGHTS.staleness, findings };
  }

  const staleCount = fileStaleFindings.length;
  const score = Math.round(((totalRefs - staleCount) / totalRefs) * 100);
  for (const finding of fileStaleFindings) {
    findings.push(finding.summary);
  }

  return { name: "staleness", score: clamp(score), weight: DIMENSION_WEIGHTS.staleness, findings };
}

export function scoreRedundancy(file: NormalizedInstructionFile, allFiles: NormalizedInstructionFile[]): QualityDimension {
  const otherDirectives = allFiles
    .filter((candidate) => candidate.path !== file.path)
    .flatMap((candidate) => candidate.directives.map((directive) => directive.normalizedText));
  const otherSet = new Set(otherDirectives);

  const duplicateCount = file.directives.filter((directive) => otherSet.has(directive.normalizedText)).length;
  const score = Math.max(0, 100 - duplicateCount * 10);
  const findings: string[] = [];
  if (duplicateCount > 0) {
    findings.push(`${duplicateCount} instruction(s) in ${file.path} are duplicated in other files`);
  }

  return { name: "redundancy", score: clamp(score), weight: DIMENSION_WEIGHTS.redundancy, findings };
}

export function scoreConflict(file: NormalizedInstructionFile, conflictFindings: DriftFinding[]): QualityDimension {
  const fileConflicts = conflictFindings.filter(
    (finding) => finding.type === "conflict" && finding.affectedFiles.includes(file.path)
  );
  const score = Math.max(0, 100 - fileConflicts.length * 15);
  const findings = fileConflicts.map((finding) => finding.summary);

  return { name: "conflict", score: clamp(score), weight: DIMENSION_WEIGHTS.conflict, findings };
}

export function scoreConsistency(allFiles: NormalizedInstructionFile[]): QualityDimension {
  if (allFiles.length <= 1) {
    return { name: "consistency", score: 100, weight: DIMENSION_WEIGHTS.consistency, findings: [] };
  }

  let totalParity = 0;
  let pairs = 0;

  for (let leftIndex = 0; leftIndex < allFiles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < allFiles.length; rightIndex += 1) {
      const leftTexts = new Set(allFiles[leftIndex]?.directives.map((directive) => directive.normalizedText) ?? []);
      const rightTexts = new Set(allFiles[rightIndex]?.directives.map((directive) => directive.normalizedText) ?? []);
      const overlap = [...leftTexts].filter((text) => rightTexts.has(text)).length;
      const maxSize = Math.max(leftTexts.size, rightTexts.size, 1);
      totalParity += overlap / maxSize;
      pairs += 1;
    }
  }

  const score = pairs > 0 ? Math.round((totalParity / pairs) * 100) : 100;
  const findings: string[] = [];
  if (score < 70) {
    findings.push(`${Math.round(score)}% content parity across ${allFiles.length} instruction files`);
  }

  return { name: "consistency", score: clamp(score), weight: DIMENSION_WEIGHTS.consistency, findings };
}

export function scoreCompleteness(file: NormalizedInstructionFile, context: RepoQualityContext): QualityDimension {
  const expectedCategories: DirectiveCategory[] = [];
  const presentCategories = new Set(file.directives.map((directive) => directive.category));

  if (context.hasTests) expectedCategories.push("testing");
  if (context.hasCI) expectedCategories.push("workflow");
  if (context.hasSecurityCode) expectedCategories.push("security");
  if (file.directives.length > 0) expectedCategories.push("style");

  if (expectedCategories.length === 0) {
    return { name: "completeness", score: 100, weight: DIMENSION_WEIGHTS.completeness, findings: [] };
  }

  const present = expectedCategories.filter((category) => presentCategories.has(category)).length;
  const score = Math.round((present / expectedCategories.length) * 100);
  const findings: string[] = [];
  const missing = expectedCategories.filter((category) => !presentCategories.has(category));
  if (missing.length > 0) {
    findings.push(`Missing expected sections: ${missing.join(", ")}`);
  }

  return { name: "completeness", score: clamp(score), weight: DIMENSION_WEIGHTS.completeness, findings };
}

export function scoreTokenEfficiency(tokenCount: number): QualityDimension {
  const monthlyCost = estimateMonthlyCost(tokenCount);
  const findings: string[] = [];

  let score: number;
  if (monthlyCost <= 0) {
    score = 100;
  } else if (monthlyCost <= 5) {
    score = Math.round(100 - (monthlyCost / 5) * 20);
  } else if (monthlyCost <= 20) {
    score = Math.round(80 - ((monthlyCost - 5) / 15) * 30);
  } else if (monthlyCost <= 50) {
    score = Math.round(50 - ((monthlyCost - 20) / 30) * 30);
  } else {
    score = 20;
  }

  if (monthlyCost > 5) {
    findings.push(`Estimated excess token cost: ~$${monthlyCost.toFixed(0)}/month`);
  }

  return { name: "tokenEfficiency", score: clamp(score), weight: DIMENSION_WEIGHTS.tokenEfficiency, findings };
}

function computeCompositeScore(dimensions: QualityDimension[]): number {
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (totalWeight === 0) return 100;
  const weighted = dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0);
  return clamp(Math.round(weighted / totalWeight));
}

export function labelForScore(score: number): QualityLabel {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "fair";
  if (score >= 40) return "needs-work";
  return "poor";
}

export function estimateMonthlyCost(tokenCount: number): number {
  return (tokenCount * 20 * 30 * 0.003) / 1000;
}

export function computeFileQualityScore(
  file: NormalizedInstructionFile,
  allFiles: NormalizedInstructionFile[],
  findings: DriftFinding[],
  context: RepoQualityContext
): FileQualityScore {
  const tokenCount = approximateTokenCount(file.rawContent);
  const optimalTokenRange = OPTIMAL_TOKEN_RANGE[file.fileType] ?? DEFAULT_OPTIMAL_RANGE;

  const dimensions: QualityDimension[] = [
    scoreVerbosity(file),
    scoreStaleness(file, findings),
    scoreRedundancy(file, allFiles),
    scoreConflict(file, findings),
    scoreConsistency(allFiles),
    scoreCompleteness(file, context),
    scoreTokenEfficiency(tokenCount)
  ];

  const compositeScore = computeCompositeScore(dimensions);

  return {
    filePath: file.path,
    fileType: file.fileType,
    tokenCount,
    optimalTokenRange,
    qualityBreakdown: { dimensions, compositeScore },
    estimatedMonthlyCostImpact: estimateMonthlyCost(tokenCount),
    label: labelForScore(compositeScore)
  };
}

export function computeRepoQualityScore(
  constitution: ConstitutionGraph,
  context: RepoQualityContext,
  findings: DriftFinding[]
): RepoQualityScore {
  const sourceFiles = constitution.sourceFiles;

  if (sourceFiles.length === 0) {
    return {
      compositeScore: 0,
      fileScores: [],
      crossToolParityScore: 0,
      totalTokens: 0,
      estimatedMonthlyCostImpact: 0,
      totalFindings: findings.length,
      findingsBySeverity: countBySeverity(findings)
    };
  }

  const fileScores = sourceFiles.map((file) => computeFileQualityScore(file, sourceFiles, findings, context));
  const totalTokens = fileScores.reduce((sum, fileScore) => sum + fileScore.tokenCount, 0);
  const compositeScore =
    fileScores.length > 0
      ? Math.round(
          fileScores.reduce((sum, fileScore) => sum + fileScore.qualityBreakdown.compositeScore, 0) /
            fileScores.length
        )
      : 0;
  const crossToolParityScore = scoreConsistency(sourceFiles).score;

  return {
    compositeScore,
    fileScores,
    crossToolParityScore,
    totalTokens,
    estimatedMonthlyCostImpact: estimateMonthlyCost(totalTokens),
    totalFindings: findings.length,
    findingsBySeverity: countBySeverity(findings)
  };
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function countBySeverity(findings: DriftFinding[]): RepoQualityScore["findingsBySeverity"] {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    if (finding.severity in counts) {
      counts[finding.severity as keyof typeof counts] += 1;
    }
  }
  return counts;
}
