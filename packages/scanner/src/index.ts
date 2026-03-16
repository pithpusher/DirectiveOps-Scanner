import { promises as fs } from "node:fs";
import path from "node:path";
import type { ConstitutionGraph, DirectiveCategory } from "@directiveops/constitution-model";
import { buildConstitutionGraph } from "@directiveops/parser";
import { evaluatePolicies } from "@directiveops/policy-engine";
import type { DriftFinding, PolicyRule } from "@directiveops/oss-types";

export interface LocalBaselineConfig {
  additionalInstructionPaths?: string[];
  requiredCategories?: DirectiveCategory[];
  allowRemoteHosts?: string[];
  baselineDirectives?: Array<{
    key: string;
    category: DirectiveCategory;
    normalizedText: string;
  }>;
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
    return `${repositoryId}-local-${suffix}-${counter}`;
  };

  for (const artifact of artifacts) {
    const pathFindings = detectPathDrift({
      artifact,
      fileSet,
      organizationId,
      repositoryId,
      makeId: () => nextId("stale-path")
    });
    findings.push(...pathFindings);

    if (pkgJson) {
      const commandFindings = detectCommandDrift({
        artifact,
        pkgJson,
        organizationId,
        repositoryId,
        makeId: () => nextId("stale-command")
      });
      findings.push(...commandFindings);

      const stackFindings = detectStackAlignmentDrift({
        artifact,
        pkgJson,
        organizationId,
        repositoryId,
        makeId: () => nextId("stack-mismatch")
      });
      findings.push(...stackFindings);
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
    /(?:^|\s)(apps\/[a-zA-Z0-9_-]+)/g,
    /(?:^|\s)(packages\/[a-zA-Z0-9_-]+)/g,
    /(?:^|\s)(\.github\/[a-zA-Z0-9_./-]+)/g
  ];

  for (const pattern of pathPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(artifact.content)) !== null) {
      const raw = match[1];
      if (!raw) {
        continue;
      }
      const candidate = normalizePath(raw.trim());
      candidates.add(candidate);
    }
  }

  const findings: DriftFinding[] = [];

  candidates.forEach((candidate) => {
    const hasExactFile = fileSet.has(candidate);
    const hasPrefix = !hasExactFile && Array.from(fileSet).some((f) => f.startsWith(candidate + "/"));

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
      if (match[1]) {
        candidates.add(match[1]);
      } else {
        candidates.add("test");
      }
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
          "Update the referenced script name to match an existing script in package.json or adjust the instructions with the correct build/test command."
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

function extractMajorFromDeps(pkgJson: PackageJsonLike, depNames: string[]): number | null {
  const allDeps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.devDependencies ?? {})
  };

  for (const name of depNames) {
    const raw = allDeps[name];
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
  for (const name of engineNames) {
    const raw = engines[name];
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

export async function scanRepository(options: ScannerRunOptions): Promise<ScannerResult> {
  const baselineConfig = await loadBaselineConfig(options.rootDir, options.baselinePath);
  const artifacts = await discoverInstructionArtifacts(options.rootDir, baselineConfig);
  const repositoryName = options.repositoryName ?? path.basename(path.resolve(options.rootDir));

  const constitution = buildConstitutionGraph({
    organizationId: "local",
    repositoryId: slugify(repositoryName),
    repositoryName,
    files: artifacts.map((artifact) => ({
      path: artifact.path,
      content: artifact.content
    }))
  });

  const policyRules = buildScannerPolicies(baselineConfig);
  const organizationId = "local";
  const repositoryId = slugify(repositoryName);
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

  const highSeverityCount = findings.filter(
    (f) => f.severity === "high" || f.severity === "critical"
  ).length;
  const conflictCount = findings.filter((f) => f.type === "conflict").length;

  return {
    rootDir: options.rootDir,
    repositoryName,
    scannedAt: new Date().toISOString(),
    discoveredFiles: artifacts.map((artifact) => artifact.path),
    constitution,
    findings,
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
    `# DirectiveOps OSS Scanner Report`,
    poweredByFooter ? `*Powered by DirectiveOps scanner*` : ``,
    ``,
    `- ${sanitize ? "Repository: [redacted]" : `Repository: ${result.repositoryName}`}`,
    `- Scanned at: ${result.scannedAt}`,
    `- Instruction files discovered: ${result.summary.instructionFileCount}`,
    `- Directives extracted: ${result.summary.directiveCount}`,
    `- Basic findings: ${result.summary.findingCount}`,
    `- High severity findings: ${result.summary.highSeverityCount}`,
    `- Drift score: ${result.summary.driftScore}`,
    `- Conflicting instructions: ${result.summary.conflictCount}`,
    ``,
    `## Discovered Files`,
    ...(sanitize
      ? [`- ${result.summary.instructionFileCount} file(s) discovered`]
      : result.discoveredFiles.map((file) => `- \`${file}\``)),
    ``,
    `## Findings`,
    ...(result.findings.length === 0
      ? ["No basic findings were detected in this local scan."]
      : result.findings.map((finding) =>
          sanitize
            ? `- [${finding.severity.toUpperCase()}] ${finding.summary}`
            : `- [${finding.severity.toUpperCase()}] ${finding.summary} (${finding.affectedFiles.join(", ")})`
        )),
    ``,
    `---`,
    ``,
    poweredByFooter
      ? `Powered by [DirectiveOps](https://directiveops.dev) — standardize and roll out AI coding instruction files across repositories.`
      : `Generated by [DirectiveOps Scanner](https://directiveops.dev).`
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
  if (
    relativePath === "AGENTS.md" ||
    relativePath === "CLAUDE.md" ||
    relativePath === "GEMINI.md" ||
    relativePath === ".github/copilot-instructions.md"
  ) {
    return true;
  }

  if (relativePath.startsWith(".github/instructions/") && relativePath.endsWith(".instructions.md")) {
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

