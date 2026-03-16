#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Import from built scanner package for runtime; during local development you can run via root `scan` script.
import type { ScannerResult } from "@directiveops/scanner";
import { renderMarkdownReport, scanRepository } from "@directiveops/scanner";

const CLI_VERSION =
  (() => {
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

  const result = await scanRepository({
    rootDir,
    baselinePath: args.baseline ? path.resolve(args.baseline) : undefined
  });

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

    if (value === "--format" && next && (next === "summary" || next === "json")) {
      args.format = next;
      index += 1;
      continue;
    }

    if (value === "--quiet") {
      args.quiet = true;
      continue;
    }

    if (value === "--fail-on" && next) {
      if (next === "none" || next === "any" || next === "high") {
        args.failOn = next;
        index += 1;
        continue;
      }
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
  }

  return args;
}

function printSummary(result: ScannerResult) {
  const s = result.summary;
  console.log(`DirectiveOps OSS scanner`);
  console.log(`Repository: ${result.repositoryName}`);
  console.log(``);
  console.log(
    `Instruction files: ${s.instructionFileCount} · Directives: ${s.directiveCount} · Findings: ${s.findingCount} · High severity: ${s.highSeverityCount}`
  );
  console.log(`Drift score: ${s.driftScore} · Conflicting instructions: ${s.conflictCount}`);

  if (result.findings.length > 0) {
    console.log(``);
    console.log(`Top findings:`);
    result.findings.slice(0, 5).forEach((finding) => {
      console.log(`- [${finding.severity.toUpperCase()}] ${finding.summary}`);
    });
  }

  console.log(``);
  console.log(
    `DirectiveOps Scanner focuses on local discovery and findings. For hosted dashboards, standards, and coordinated rollouts across repositories, see https://directiveops.dev.`
  );
}

function printHelp() {
  console.log(`DirectiveOps Scanner CLI`);
  console.log(``);
  console.log(`Scan AGENTS.md, CLAUDE.md, GEMINI.md, and Copilot instruction files, then export local findings.`);
  console.log(``);
  console.log(`Usage: directiveops-scanner scan [options]`);
  console.log(`       directiveops-scanner --help | --version`);
  console.log(``);
  console.log(`Options:`);
  console.log(`  --path <dir>       Repository root to scan (default: .)`);
  console.log(`  --format <fmt>     summary (default) or json`);
  console.log(`  --quiet            Suppress human-readable summary output (useful for CI)`);
  console.log(`  --fail-on <level>  Control exit code: none (default), any, or high`);
  console.log(`  --output <file>    Write full JSON result to file`);
  console.log(`  --markdown <file>  Write markdown report to file`);
  console.log(`  --sanitize         With --markdown, redact repo name and file paths for sharing`);
  console.log(`  --baseline <file>  Path to directiveops.config.json (default: <repo>/directiveops.config.json)`);
  console.log(`  -h, --help         Show this help`);
  console.log(`  -V, --version      Show version`);
  console.log(``);
  console.log(`Examples:`);
  console.log(`  directiveops-scanner scan --path .`);
  console.log(
    `  directiveops-scanner scan --path . --format json --output directiveops-report.json --markdown directiveops-report.md`
  );
  console.log(`  directiveops-scanner scan --path . --markdown report.md --sanitize`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

