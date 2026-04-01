#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverInstructionArtifacts,
  loadBaselineConfig,
  renderMarkdownReport,
  scanRepository,
  type ScannerResult
} from "@directiveops/scanner";
import { labelForScore, estimateMonthlyCost } from "@directiveops/policy-engine";
import type { FileQualityScore, InstructionFileType } from "@directiveops/constitution-model";
import { detectInstructionFileType, parseInstructionFile, translateFile } from "@directiveops/parser";

const CLI_VERSION = (() => {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return (pkg as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

interface CliArgs {
  command: string | null;
  path: string;
  format: "summary" | "json";
  quiet?: boolean;
  failOn?: "none" | "any" | "high";
  output?: string;
  markdown?: string;
  sanitize?: boolean;
  baseline?: string;
  help?: boolean;
  version?: boolean;
  target?: string;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (args.version || argv.includes("--version") || argv.includes("-V")) {
    console.log(CLI_VERSION);
    process.exit(0);
  }

  if (args.command === "fix") {
    console.log("The fix command requires an API key.");
    console.log("Set DIRECTIVEOPS_LLM_API_KEY in your environment. Coming soon.");
    process.exit(0);
  }

  if (args.command === "translate") {
    await runTranslate(args);
    process.exit(0);
  }

  if (args.command !== "scan") {
    printHelp();
    process.exit(args.command ? 1 : 0);
  }

  const rootDir = path.resolve(args.path);
  const stat = await fs.stat(rootDir).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`Error: path is not a directory: ${rootDir}`);
    process.exit(1);
  }

  let result: ScannerResult;
  try {
    result = await scanRepository({
      rootDir,
      baselinePath: args.baseline ? path.resolve(args.baseline) : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }

  if (args.format === "json") {
    const payload = JSON.stringify(result, null, 2);
    if (args.output) {
      await fs.writeFile(path.resolve(args.output), payload, "utf8");
    } else {
      console.log(payload);
    }
  } else if (!args.quiet) {
    printSummary(result);
  }

  if (args.markdown) {
    const report = renderMarkdownReport(result, {
      sanitize: args.sanitize ?? false,
      poweredByFooter: true
    });
    await fs.writeFile(path.resolve(args.markdown), report, "utf8");
    console.log(`Markdown report saved to ${path.resolve(args.markdown)}`);
  }

  if (args.output && args.format !== "json") {
    await fs.writeFile(path.resolve(args.output), JSON.stringify(result, null, 2), "utf8");
    console.log(`JSON report saved to ${path.resolve(args.output)}`);
  }

  if (args.failOn && args.failOn !== "none") {
    const hasAny = result.findings.length > 0;
    const hasHigh = result.findings.some(
      (finding) => finding.severity === "high" || finding.severity === "critical"
    );

    if ((args.failOn === "any" && hasAny) || (args.failOn === "high" && hasHigh)) {
      process.exit(1);
    }
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: argv[0] ?? null,
    path: ".",
    format: "summary"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (value === "--version" || value === "-V") {
      args.version = true;
      continue;
    }
    if (value === "--path" && next) {
      args.path = next;
      index += 1;
      continue;
    }
    if (value === "--json") {
      args.format = "json";
      continue;
    }
    if (value === "--format" && next && (next === "summary" || next === "json")) {
      args.format = next;
      index += 1;
      continue;
    }
    if (value === "--quiet") {
      args.quiet = true;
      continue;
    }
    if (value === "--fail-on" && next && (next === "none" || next === "any" || next === "high")) {
      args.failOn = next;
      index += 1;
      continue;
    }
    if (value === "--output" && next) {
      args.output = next;
      index += 1;
      continue;
    }
    if (value === "--markdown" && next) {
      args.markdown = next;
      index += 1;
      continue;
    }
    if (value === "--sanitize") {
      args.sanitize = true;
      continue;
    }
    if (value === "--baseline" && next) {
      args.baseline = next;
      index += 1;
      continue;
    }
    if (value === "--target" && next) {
      args.target = next;
      index += 1;
      continue;
    }
  }

  return args;
}

const TARGET_FORMAT_MAP: Record<string, InstructionFileType> = {
  "agents-md": "AGENTS_MD",
  "claude-md": "CLAUDE_MD",
  "cursor-rules": "CURSOR_RULES",
  copilot: "COPILOT_INSTRUCTIONS",
  "github-instructions": "GITHUB_INSTRUCTIONS",
  windsurf: "WINDSURF_INSTRUCTIONS",
  gemini: "GEMINI_MD",
  "copilot-config": "COPILOT_CONFIG"
};

async function runTranslate(args: CliArgs) {
  const target = args.target;
  if (!target || !TARGET_FORMAT_MAP[target]) {
    console.error(`Error: --target is required. Valid targets: ${Object.keys(TARGET_FORMAT_MAP).join(", ")}`);
    process.exit(1);
  }

  const targetType = TARGET_FORMAT_MAP[target];
  const rootDir = path.resolve(args.path);
  const stat = await fs.stat(rootDir).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`Error: path is not a directory: ${rootDir}`);
    process.exit(1);
  }

  const config = await loadBaselineConfig(rootDir, args.baseline ? path.resolve(args.baseline) : undefined);
  const artifacts = await discoverInstructionArtifacts(rootDir, config);

  if (artifacts.length === 0) {
    console.log(`No instruction files found in ${rootDir}`);
    return;
  }

  const outputDir = args.output ? path.resolve(args.output) : path.join(rootDir, ".directiveops", "translated");
  await fs.mkdir(outputDir, { recursive: true });

  let count = 0;
  for (const artifact of artifacts) {
    const sourceType = detectInstructionFileType(artifact.path);
    if (sourceType === "UNKNOWN" || sourceType === "PROMPT_FILE") {
      continue;
    }
    if (sourceType === targetType) {
      continue;
    }

    const parsed = parseInstructionFile({
      organizationId: "local",
      repositoryId: "local",
      path: artifact.path,
      content: artifact.content
    });

    const translated = translateFile(parsed, targetType);
    const outName = artifact.path.replace(/\\/g, "/").replace(/\//g, "__") + `.${target}.md`;
    const outPath = path.join(outputDir, outName);
    await fs.writeFile(outPath, translated, "utf8");
    count += 1;
    console.log(`  ${artifact.path} -> ${outName}`);
  }

  if (count === 0) {
    console.log(`No files to translate (all files are already in ${target} format).`);
  } else {
    console.log(`\nTranslated ${count} file(s) to ${outputDir}`);
  }
}

function printSummary(result: Awaited<ReturnType<typeof scanRepository>>) {
  const quality = result.qualityScore;
  const summary = result.summary;

  console.log(`DirectiveOps Score: ${quality.compositeScore}/100 (${labelForScore(quality.compositeScore)})`);
  console.log(`Repository: ${result.repositoryName}`);
  console.log("");

  if (quality.fileScores.length > 0) {
    console.log("File scores:");
    for (const fileScore of quality.fileScores) {
      const bar = renderBar(fileScore.qualityBreakdown.compositeScore);
      const name = shortenPath(fileScore.filePath);
      const label = labelForScore(fileScore.qualityBreakdown.compositeScore);
      console.log(`  ${bar} ${String(fileScore.qualityBreakdown.compositeScore).padStart(3)}/100  ${name} (${label})`);
    }
    console.log("");
  }

  const topIssues = collectTopIssues(quality.fileScores);
  if (topIssues.length > 0) {
    console.log("Top issues:");
    for (const issue of topIssues.slice(0, 5)) {
      console.log(`  ${issue}`);
    }
    console.log("");
  }

  if (quality.fileScores.length > 1) {
    console.log(`Cross-tool sync: ${quality.crossToolParityScore}% parity across ${quality.fileScores.length} instruction files`);
  }

  if (quality.totalTokens > 0) {
    const cost = estimateMonthlyCost(quality.totalTokens);
    console.log(`Token overhead: ~${quality.totalTokens.toLocaleString()} tokens - ~$${cost.toFixed(0)}/month estimated excess cost`);
  }

  console.log("");
  console.log(
    `Instruction files: ${summary.instructionFileCount} - Instructions: ${summary.directiveCount} - Issues: ${summary.findingCount} - High severity: ${summary.highSeverityCount}`
  );

  if (result.findings.length > 0) {
    console.log("");
    console.log("Top findings:");
    result.findings.slice(0, 5).forEach((finding) => {
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.summary}`);
    });
  }

  console.log("");
  console.log("When hosted becomes useful:");
  console.log(
    "Use hosted DirectiveOps when you need fleet-wide dashboards, retained history, drift alerts, PR-driven rollouts, and multi-user governance across repositories."
  );
  console.log("");
  console.log("Learn more: https://directiveops.dev");
}

function renderBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return `[${"#".repeat(filled)}${".".repeat(empty)}]`;
}

function shortenPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : filePath;
}

function collectTopIssues(fileScores: FileQualityScore[]): string[] {
  const issues: string[] = [];
  for (const fileScore of fileScores) {
    for (const dimension of fileScore.qualityBreakdown.dimensions) {
      if (dimension.score < 80 && dimension.weight > 0) {
        const deduction = Math.round((100 - dimension.score) * dimension.weight);
        for (const finding of dimension.findings) {
          issues.push(`-${deduction} pts  ${finding}`);
        }
      }
    }
  }

  issues.sort((left, right) => {
    const leftValue = Number.parseInt(left.match(/-(\d+)/)?.[1] ?? "0", 10);
    const rightValue = Number.parseInt(right.match(/-(\d+)/)?.[1] ?? "0", 10);
    return rightValue - leftValue;
  });

  return issues;
}

function printHelp() {
  console.log("DirectiveOps Scanner CLI");
  console.log("");
  console.log("Score and scan AI coding instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, Windsurf).");
  console.log("");
  console.log("Usage: directiveops <command> [options]");
  console.log("       directiveops --help | --version");
  console.log("");
  console.log("Commands:");
  console.log("  scan               Score and scan instruction files for issues");
  console.log("  fix                Generate optimized instruction files (requires API key)");
  console.log("  translate          Translate instruction files to another tool's format");
  console.log("");
  console.log("Scan options:");
  console.log("  --path <dir>       Repository root to scan (default: .)");
  console.log("  --format <fmt>     summary (default) or json");
  console.log("  --json             Shorthand for --format json");
  console.log("  --quiet            Suppress human-readable summary output (useful for CI)");
  console.log("  --fail-on <level>  Control exit code: none (default), any, or high");
  console.log("  --output <file>    Write full JSON result to file");
  console.log("  --markdown <file>  Write markdown report to file");
  console.log("  --sanitize         With --markdown, redact repo name and file paths for sharing");
  console.log("  --baseline <file>  Path to directiveops.config.json (default: <repo>/directiveops.config.json)");
  console.log("  -h, --help         Show this help");
  console.log("  -V, --version      Show version");
  console.log("");
  console.log("Translate options:");
  console.log("  --target <format>  Target format: agents-md, claude-md, cursor-rules, copilot,");
  console.log("                     github-instructions, windsurf, gemini, copilot-config");
  console.log("  --path <dir>       Repository root to scan (default: .)");
  console.log("  --output <dir>     Output directory (default: .directiveops/translated/)");
  console.log("");
  console.log("Examples:");
  console.log("  directiveops scan --path .");
  console.log("  directiveops scan --path . --json --output directiveops-report.json");
  console.log("  directiveops scan --path . --markdown report.md --sanitize");
  console.log("  directiveops translate --target claude-md --path .");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
