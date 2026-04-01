import { promises as fs } from "node:fs";
import path from "node:path";
import type { ConstitutionGraph, DirectiveCategory, RepoQualityScore } from "@directiveops/constitution-model";
import { buildConstitutionGraph, matchInstructionFile } from "@directiveops/parser";
import { computeRepoQualityScore, evaluatePolicies, type RepoQualityContext } from "@directiveops/policy-engine";
import type { DriftFinding, PolicyRule } from "@directiveops/oss-types";

export interface RequiredContentRule {
  id: string;
  label?: string;
  contains?: string;
  pattern?: string;
  pathPatterns?: string[];
}

export interface LocalBaselineConfig {
  additionalInstructionPaths?: string[];
  requiredCategories?: DirectiveCategory[];
  allowRemoteHosts?: string[];
  baselineDirectives?: Array<{
    key: string;
    category: DirectiveCategory;
    normalizedText: string;
  }>;
  requiredContent?: RequiredContentRule[];
}

export interface ScannerRunOptions {
  rootDir: string;
  repositoryName?: string;
  baselinePath?: string;
}

export interface ScannerResult {
  rootDir: string;
  repositoryName: string;
  scannedAt: string;
  discoveredFiles: string[];
  constitution: ConstitutionGraph;
  findings: DriftFinding[];
  qualityScore: RepoQualityScore;
  summary: {
    instructionFileCount: number;
    directiveCount: number;
    findingCount: number;
    highSeverityCount: number;
    driftScore: number;
    conflictCount: number;
  };
  baselineConfig: LocalBaselineConfig;
}

const DEFAULT_IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "coverage"]);
const DEFAULT_BASELINE_FILE = "directiveops.config.json";
const MAX_BASELINE_PATTERN_LENGTH = 2048;

interface InstructionArtifact {
  path: string;
  content: string;
}

interface PackageJsonLike {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

interface DetectLocalDriftOptions {
  rootDir: string;
  artifacts: InstructionArtifact[];
  organizationId: string;
  repositoryId: string;
}

async function detectLocalDriftFindings(options: DetectLocalDriftOptions): Promise<DriftFinding[]> {
  const { rootDir, artifacts, organizationId, repositoryId } = options;
  const findings: DriftFinding[] = [];

  const allFiles = await walk(rootDir);
  const fileSet = new Set(allFiles);
  const pkgJson = await loadPackageJson(rootDir);

  let counter = 0;
  const nextId = (suffix: string) => {
    counter += 1;
    return `finding:${repositoryId}:local-${suffix}:${counter}`;
  };

  for (const artifact of artifacts) {
    findings.push(
      ...detectPathDrift({
        artifact,
        fileSet,
        organizationId,
        repositoryId,
        makeId: () => nextId("stale-path")
      })
    );

    if (pkgJson) {
      findings.push(
        ...detectCommandDrift({
          artifact,
          pkgJson,
          organizationId,
          repositoryId,
          makeId: () => nextId("stale-command")
        })
      );

      findings.push(
        ...detectStackAlignmentDrift({
          artifact,
          pkgJson,
          organizationId,
          repositoryId,
          makeId: () => nextId("stack-mismatch")
        })
      );
    }
  }

  return findings;
}

async function loadPackageJson(rootDir: string): Promise<PackageJsonLike | null> {
  try {
    const content = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    return JSON.parse(content) as PackageJsonLike;
  } catch {
    return null;
  }
}

function detectPathDrift(options: {
  artifact: InstructionArtifact;
  fileSet: Set<string>;
  organizationId: string;
  repositoryId: string;
  makeId: () => string;
}): DriftFinding[] {
  const { artifact, fileSet, organizationId, repositoryId, makeId } = options;
  const candidates = new Set<string>();

  const pathPatterns = [
    /(?:^|[\s\-*>])(apps\/[a-zA-Z0-9_-]+)/gm,
    /(?:^|[\s\-*>])(packages\/[a-zA-Z0-9_-]+)/gm,
    /(?:^|[\s\-*>])(\.github\/[a-zA-Z0-9_./-]+)/gm
  ];

  for (const pattern of pathPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(artifact.content)) !== null) {
      const raw = match[1];
      if (!raw) {
        continue;
      }
      candidates.add(normalizePath(raw.trim()));
    }
  }

  const findings: DriftFinding[] = [];

  candidates.forEach((candidate) => {
    const hasExactFile = fileSet.has(candidate);
    const hasPrefix = !hasExactFile && Array.from(fileSet).some((file) => file.startsWith(candidate + "/"));

    if (!hasExactFile && !hasPrefix) {
      findings.push({
        id: makeId(),
        organizationId,
        repositoryId,
        type: "stale-reference",
        severity: "medium",
        status: "open",
        summary: `Instruction file references path that does not exist: ${candidate}`,
        explanation: `The instruction file ${artifact.path} references a path (${candidate}) that was not found in this repository. This often happens after a directory or package rename.`,
        affectedFiles: [artifact.path],
        affectedScope: artifact.path,
        suggestedRemediation:
          "Update the referenced path to match the current repository layout or adjust the instructions to point at the correct package or directory."
      });
    }
  });

  return findings;
}

function detectCommandDrift(options: {
  artifact: InstructionArtifact;
  pkgJson: PackageJsonLike;
  organizationId: string;
  repositoryId: string;
  makeId: () => string;
}): DriftFinding[] {
  const { artifact, pkgJson, organizationId, repositoryId, makeId } = options;
  const scripts = pkgJson.scripts ?? {};
  const candidates = new Set<string>();

  const patterns = [
    /`(?:npm|pnpm|yarn|bun)\s+run\s+([a-zA-Z0-9:_-]+)`/g,
    /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+run\s+([a-zA-Z0-9:_-]+)/gm,
    /`(?:npm|pnpm|yarn)\s+test`/g,
    /(?:^|\s)(?:npm|pnpm|yarn)\s+test/gm
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(artifact.content)) !== null) {
      candidates.add(match[1] || "test");
    }
  }

  const findings: DriftFinding[] = [];

  candidates.forEach((scriptName) => {
    if (!scripts[scriptName]) {
      findings.push({
        id: makeId(),
        organizationId,
        repositoryId,
        type: "stale-reference",
        severity: "medium",
        status: "open",
        summary: `Instruction file references npm script that does not exist: ${scriptName}`,
        explanation: `The instruction file ${artifact.path} references an npm script (${scriptName}) that is not defined in this repository's package.json. This often happens after commands are renamed or removed.`,
        affectedFiles: [artifact.path],
        affectedScope: artifact.path,
        suggestedRemediation:
          "Update the referenced script name to match an existing script in package.json or adjust the instructions with the correct build or test command."
      });
    }
  });

  return findings;
}

function detectStackAlignmentDrift(options: {
  artifact: InstructionArtifact;
  pkgJson: PackageJsonLike;
  organizationId: string;
  repositoryId: string;
  makeId: () => string;
}): DriftFinding[] {
  const { artifact, pkgJson, organizationId, repositoryId, makeId } = options;
  const findings: DriftFinding[] = [];
  const content = artifact.content;

  const nextClaim = extractMajorVersion(content, /Next\.js\s+(\d+)/i);
  const reactClaim = extractMajorVersion(content, /React\s+(\d+)/i);
  const nodeClaim = extractMajorVersion(content, /Node(?:\.js)?\s+(\d+)/i);

  const nextActual = extractMajorFromDeps(pkgJson, ["next"]);
  const reactActual = extractMajorFromDeps(pkgJson, ["react", "react-dom"]);
  const nodeActual = extractMajorFromEngines(pkgJson, ["node"]);

  if (nextClaim !== null && nextActual !== null && nextClaim !== nextActual) {
    findings.push({
      id: makeId(),
      organizationId,
      repositoryId,
      type: "stale-reference",
      severity: "low",
      status: "open",
      summary: `Instructions mention Next.js ${nextClaim}, but package.json uses Next.js ${nextActual}`,
      explanation:
        `The instruction file ${artifact.path} claims the project uses Next.js version ${nextClaim}, but package.json dependencies indicate major version ${nextActual}.`,
      affectedFiles: [artifact.path],
      affectedScope: artifact.path,
      suggestedRemediation:
        "Update the documented Next.js version to match package.json or upgrade the dependency so the instructions remain accurate."
    });
  }

  if (reactClaim !== null && reactActual !== null && reactClaim !== reactActual) {
    findings.push({
      id: makeId(),
      organizationId,
      repositoryId,
      type: "stale-reference",
      severity: "low",
      status: "open",
      summary: `Instructions mention React ${reactClaim}, but package.json uses React ${reactActual}`,
      explanation:
        `The instruction file ${artifact.path} claims the project uses React version ${reactClaim}, but package.json dependencies indicate major version ${reactActual}.`,
      affectedFiles: [artifact.path],
      affectedScope: artifact.path,
      suggestedRemediation:
        "Update the documented React version to match package.json or upgrade the dependency so the instructions remain accurate."
    });
  }

  if (nodeClaim !== null && nodeActual !== null && nodeClaim !== nodeActual) {
    findings.push({
      id: makeId(),
      organizationId,
      repositoryId,
      type: "stale-reference",
      severity: "low",
      status: "open",
      summary: `Instructions mention Node ${nodeClaim}, but engines field specifies Node ${nodeActual}`,
      explanation:
        `The instruction file ${artifact.path} claims the project uses Node version ${nodeClaim}, but the engines field in package.json indicates major version ${nodeActual}.`,
      affectedFiles: [artifact.path],
      affectedScope: artifact.path,
      suggestedRemediation:
        "Update the documented Node version to match the engines field or adjust the engines constraint so the instructions and runtime expectations are aligned."
    });
  }

  return findings;
}

function extractMajorVersion(content: string, pattern: RegExp): number | null {
  const match = pattern.exec(content);
  if (!match) {
    return null;
  }
  const raw = match[1];
  if (!raw) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

function extractMajorFromDeps(pkgJson: PackageJsonLike, dependencyNames: string[]): number | null {
  const allDeps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.devDependencies ?? {})
  };

  for (const dependencyName of dependencyNames) {
    const raw = allDeps[dependencyName];
    if (!raw) continue;
    const major = parseSemverMajor(raw);
    if (major !== null) {
      return major;
    }
  }

  return null;
}

function extractMajorFromEngines(pkgJson: PackageJsonLike, engineNames: string[]): number | null {
  const engines = pkgJson.engines ?? {};
  for (const engineName of engineNames) {
    const raw = engines[engineName];
    if (!raw) continue;
    const major = parseSemverMajor(raw);
    if (major !== null) {
      return major;
    }
  }
  return null;
}

function parseSemverMajor(raw: string): number | null {
  const match = /(\d+)/.exec(raw);
  if (!match) {
    return null;
  }
  const group = match[1];
  if (!group) {
    return null;
  }
  const value = Number.parseInt(group, 10);
  return Number.isNaN(value) ? null : value;
}

export function validateBaselineConfig(config: LocalBaselineConfig): void {
  for (const rule of config.requiredContent ?? []) {
    if (!rule.id?.trim()) {
      throw new Error('directiveops baseline: each requiredContent rule must have a non-empty "id"');
    }
    const hasContains = rule.contains != null && rule.contains !== "";
    const hasPattern = rule.pattern != null && rule.pattern !== "";
    if (hasContains === hasPattern) {
      throw new Error(
        `directiveops baseline: requiredContent rule "${rule.id}" must set exactly one of "contains" or "pattern"`
      );
    }
    if (hasPattern && (rule.pattern?.length ?? 0) > MAX_BASELINE_PATTERN_LENGTH) {
      throw new Error(
        `directiveops baseline: requiredContent rule "${rule.id}" pattern exceeds ${MAX_BASELINE_PATTERN_LENGTH} characters`
      );
    }
    if (hasPattern) {
      try {
        new RegExp(rule.pattern ?? "");
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`directiveops baseline: requiredContent rule "${rule.id}" has invalid regex: ${detail}`);
      }
    }
    if (rule.pathPatterns != null) {
      const isStringArray = Array.isArray(rule.pathPatterns) && rule.pathPatterns.every((pattern) => typeof pattern === "string");
      if (!isStringArray) {
        throw new Error(
          `directiveops baseline: requiredContent rule "${rule.id}" pathPatterns must be an array of strings`
        );
      }
    }
  }
}

export async function scanRepository(options: ScannerRunOptions): Promise<ScannerResult> {
  const baselineConfig = await loadBaselineConfig(options.rootDir, options.baselinePath);
  validateBaselineConfig(baselineConfig);
  const artifacts = await discoverInstructionArtifacts(options.rootDir, baselineConfig);
  const repositoryName = options.repositoryName ?? path.basename(path.resolve(options.rootDir));
  const organizationId = "local";
  const repositoryId = slugify(repositoryName);

  const constitution = buildConstitutionGraph({
    organizationId,
    repositoryId,
    repositoryName,
    files: artifacts.map((artifact) => ({ path: artifact.path, content: artifact.content }))
  });

  const policyRules = buildScannerPolicies(baselineConfig);
  const rawFindings = evaluatePolicies({
    organizationId,
    repositoryId,
    constitution,
    policyRules,
    baselineDirectives: baselineConfig.baselineDirectives ?? [],
    repoOverrides: []
  });
  const localDriftFindings = await detectLocalDriftFindings({
    rootDir: options.rootDir,
    artifacts,
    organizationId,
    repositoryId
  });
  const findings = [...rawFindings, ...localDriftFindings];

  const pkgJson = await loadPackageJson(options.rootDir);
  const allFiles = await walk(options.rootDir);
  const qualityContext: RepoQualityContext = {
    hasTests: allFiles.some(
      (file) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || file.includes("__tests__/") || file.includes("test/")
    ),
    hasCI: allFiles.some(
      (file) => file.startsWith(".github/workflows/") || file.startsWith(".circleci/") || file === "Jenkinsfile"
    ),
    hasSecurityCode: allFiles.some(
      (file) => file.includes("auth") || file.includes("security") || file.includes("crypto")
    ),
    packageJson: pkgJson
  };
  const qualityScore = computeRepoQualityScore(constitution, qualityContext, findings);

  const highSeverityCount = findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "critical"
  ).length;
  const conflictCount = findings.filter((finding) => finding.type === "conflict").length;

  return {
    rootDir: options.rootDir,
    repositoryName,
    scannedAt: new Date().toISOString(),
    discoveredFiles: artifacts.map((artifact) => artifact.path),
    constitution,
    findings,
    qualityScore,
    summary: {
      instructionFileCount: constitution.sourceFiles.length,
      directiveCount: constitution.layers.flatMap((layer) => layer.directives).length,
      findingCount: findings.length,
      highSeverityCount,
      driftScore: findings.length * 10,
      conflictCount
    },
    baselineConfig
  };
}

export async function discoverInstructionArtifacts(rootDir: string, config: LocalBaselineConfig) {
  const allFiles = await walk(rootDir);
  const supported = allFiles.filter((relativePath) => isSupportedInstructionPath(relativePath, config));

  return Promise.all(
    supported.map(async (relativePath) => ({
      path: relativePath,
      content: await fs.readFile(path.join(rootDir, relativePath), "utf8")
    }))
  );
}

export async function loadBaselineConfig(rootDir: string, explicitPath?: string): Promise<LocalBaselineConfig> {
  const candidate = explicitPath ? path.resolve(explicitPath) : path.join(rootDir, DEFAULT_BASELINE_FILE);

  try {
    const content = await fs.readFile(candidate, "utf8");
    return JSON.parse(content) as LocalBaselineConfig;
  } catch {
    return {};
  }
}

export function renderMarkdownReport(
  result: ScannerResult,
  options?: { sanitize?: boolean; poweredByFooter?: boolean }
): string {
  const sanitize = options?.sanitize ?? false;
  const poweredByFooter = options?.poweredByFooter ?? false;

  const lines = [
    "# DirectiveOps OSS Scanner Report",
    poweredByFooter ? "*Powered by DirectiveOps Scanner*" : "",
    "",
    `- ${sanitize ? "Repository: [redacted]" : `Repository: ${result.repositoryName}`}`,
    `- Scanned at: ${result.scannedAt}`,
    `- Instruction files discovered: ${result.summary.instructionFileCount}`,
    `- Directives extracted: ${result.summary.directiveCount}`,
    `- Findings: ${result.summary.findingCount}`,
    `- High severity findings: ${result.summary.highSeverityCount}`,
    `- Drift score: ${result.summary.driftScore}`,
    `- Conflicting instructions: ${result.summary.conflictCount}`,
    `- Quality score: ${result.qualityScore.compositeScore}/100`,
    "",
    "## Discovered Files",
    ...(sanitize
      ? [`- ${result.summary.instructionFileCount} file(s) discovered`]
      : result.discoveredFiles.map((file) => `- \`${file}\``)),
    "",
    "## Directive Coverage",
    ...(() => {
      const counts = new Map<string, number>();
      for (const file of result.constitution.sourceFiles) {
        for (const directive of file.directives) {
          counts.set(directive.category, (counts.get(directive.category) ?? 0) + 1);
        }
      }
      if (counts.size === 0) {
        return ["No directives extracted across discovered files."];
      }
      return [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, count]) => `- ${category}: ${count}`);
    })(),
    "",
    "## Findings",
    ...(result.findings.length === 0
      ? ["No findings were detected in this local scan."]
      : result.findings.map((finding) =>
          sanitize
            ? `- [${finding.severity.toUpperCase()}] ${finding.summary}`
            : `- [${finding.severity.toUpperCase()}] ${finding.summary} (${finding.affectedFiles.join(", ")})`
        )),
    "",
    "## Quality Summary",
    `- Cross-tool parity: ${result.qualityScore.crossToolParityScore}%`,
    `- Estimated monthly token cost: ~$${result.qualityScore.estimatedMonthlyCostImpact.toFixed(0)}`,
    "",
    "---",
    "",
    poweredByFooter
      ? "Powered by [DirectiveOps Scanner](https://directiveops.dev) - standardize and review AI coding instruction files across repositories."
      : "Generated by [DirectiveOps Scanner](https://directiveops.dev)."
  ];

  return lines.join("\n");
}

function buildScannerPolicies(config: LocalBaselineConfig): PolicyRule[] {
  const requiredCategories = config.requiredCategories ?? [];
  const allowRemoteHosts = config.allowRemoteHosts ?? [];
  const rules: PolicyRule[] = [
    {
      id: "local-remote-imports",
      organizationId: "local",
      code: "LOCAL-003",
      name: "Disallow risky remote imports",
      description: "Instruction files should not import remote content outside approved sources.",
      type: "risky-import",
      severity: "high",
      enabled: true,
      config: {
        allowRemoteHosts
      }
    }
  ];

  requiredCategories.forEach((category, index) => {
    rules.push({
      id: `local-required-${index + 1}`,
      organizationId: "local",
      code: `LOCAL-REQ-${index + 1}`,
      name: `Require ${category} directive`,
      description: `The local baseline expects at least one ${category} directive.`,
      type: "required-directive",
      severity: "medium",
      enabled: true,
      config: {
        categories: [category]
      }
    });
  });

  (config.requiredContent ?? []).forEach((entry, index) => {
    rules.push({
      id: `local-required-content-${index + 1}`,
      organizationId: "local",
      code: `LOCAL-CONTENT-${index + 1}`,
      name: `Require instruction content: ${entry.label ?? entry.id}`,
      description: `The local baseline requires instruction text matching rule ${entry.id}.`,
      type: "required-content",
      severity: "medium",
      enabled: true,
      config: {
        contentRuleId: entry.id,
        label: entry.label,
        ...(entry.contains ? { contains: entry.contains } : {}),
        ...(entry.pattern ? { pattern: entry.pattern } : {}),
        ...(Array.isArray(entry.pathPatterns) && entry.pathPatterns.length > 0
          ? { pathPatterns: entry.pathPatterns }
          : {})
      }
    });
  });

  return rules;
}

async function walk(rootDir: string, currentDir = rootDir, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && DEFAULT_IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizePath(path.join(prefix, entry.name));

    if (entry.isDirectory()) {
      results.push(...(await walk(rootDir, absolutePath, relativePath)));
      continue;
    }

    results.push(relativePath);
  }

  return results;
}

function isSupportedInstructionPath(relativePath: string, config: LocalBaselineConfig): boolean {
  if (matchInstructionFile(relativePath)) {
    return true;
  }

  return (config.additionalInstructionPaths ?? []).map(normalizePath).includes(normalizePath(relativePath));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
