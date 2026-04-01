import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_SOURCE_ROOT = path.resolve(repoRoot, "..", "DirectiveOps");
const DEFAULT_TARGET_ROOT = repoRoot;

const SHARED_PATHS = [
  "apps/cli",
  "packages/scanner",
  "packages/parser",
  "packages/policy-engine",
  "packages/constitution-model"
];

const IGNORE_DIRS = new Set([".git", "node_modules", "dist", ".next", "coverage", "test-results"]);

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCE_ROOT,
    target: DEFAULT_TARGET_ROOT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === "--source" && next) {
      args.source = path.resolve(next);
      index += 1;
      continue;
    }

    if (value === "--target" && next) {
      args.target = path.resolve(next);
      index += 1;
      continue;
    }
  }

  return args;
}

function walkFiles(rootDir, currentDir = rootDir) {
  if (!existsSync(currentDir)) {
    return [];
  }

  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push(normalizePath(path.relative(rootDir, absolutePath)));
  }

  return files.sort();
}

function hashFile(filePath) {
  const buffer = readFileSync(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function compareTree(sourceRoot, targetRoot, relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  const targetPath = path.join(targetRoot, relativePath);

  const sourceExists = existsSync(sourcePath) && statSync(sourcePath).isDirectory();
  const targetExists = existsSync(targetPath) && statSync(targetPath).isDirectory();

  if (!sourceExists && !targetExists) {
    return {
      added: [],
      removed: [],
      modified: []
    };
  }

  const sourceFiles = new Set(walkFiles(sourcePath));
  const targetFiles = new Set(walkFiles(targetPath));
  const allFiles = [...new Set([...sourceFiles, ...targetFiles])].sort();

  const added = [];
  const removed = [];
  const modified = [];

  for (const file of allFiles) {
    const sourceFile = path.join(sourcePath, file);
    const targetFile = path.join(targetPath, file);
    const inSource = sourceFiles.has(file);
    const inTarget = targetFiles.has(file);

    if (inSource && !inTarget) {
      added.push(normalizePath(path.join(relativePath, file)));
      continue;
    }

    if (!inSource && inTarget) {
      removed.push(normalizePath(path.join(relativePath, file)));
      continue;
    }

    if (hashFile(sourceFile) !== hashFile(targetFile)) {
      modified.push(normalizePath(path.join(relativePath, file)));
    }
  }

  return { added, removed, modified };
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function printSection(label, items) {
  console.log(label);
  if (items.length === 0) {
    console.log("  none");
    return;
  }

  for (const item of items) {
    console.log(`  ${item}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.source)) {
    console.error(`Source repo not found: ${args.source}`);
    process.exit(1);
  }

  if (!existsSync(args.target)) {
    console.error(`Target repo not found: ${args.target}`);
    process.exit(1);
  }

  const combined = {
    added: [],
    removed: [],
    modified: []
  };

  for (const sharedPath of SHARED_PATHS) {
    const result = compareTree(args.source, args.target, sharedPath);
    combined.added.push(...result.added);
    combined.removed.push(...result.removed);
    combined.modified.push(...result.modified);
  }

  console.log("DirectiveOps sync check");
  console.log(`Source: ${args.source}`);
  console.log(`Target: ${args.target}`);
  console.log("");

  printSection("Added in DirectiveOps (missing here):", combined.added);
  console.log("");
  printSection("Removed from DirectiveOps (only here):", combined.removed);
  console.log("");
  printSection("Modified in both:", combined.modified);
  console.log("");
  console.log(
    `Summary: ${combined.added.length} added, ${combined.removed.length} removed, ${combined.modified.length} modified`
  );
}

main();
