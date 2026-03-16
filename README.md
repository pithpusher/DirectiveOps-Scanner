## DirectiveOps Scanner

DirectiveOps Scanner is an open-source CLI for discovering, normalizing, and reporting on AI coding instruction files across repositories.

It is the OSS scanner slice of the broader DirectiveOps product and is focused strictly on local analysis. The hosted DirectiveOps control-plane adds central visibility, org templates, coordinated rollouts, and history, but is not part of this repository.

### What it scans

By default, the scanner discovers:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`
- Any additional paths configured in `directiveops.config.json`

### What it produces

- **JSON output**: a `ScannerResult` containing:
  - `discoveredFiles`
  - `constitution` graph
  - `findings` (basic drift/conflict/risk findings)
  - summary counts and a simple drift score
- **Markdown report**: human-readable summary suitable for sharing or attaching to issues (with optional sanitization).

### Installation

From npm (once published):

```bash
npm install -g @directiveops/scanner-cli
```

From source:

```bash
npm install
npm run build
npx directiveops-scanner scan --path .
```

### Quickstart

Scan the current repository:

```bash
directiveops-scanner scan --path .
```

Export full JSON and a Markdown report:

```bash
directiveops-scanner scan --path . \
  --format json \
  --output directiveops-report.json \
  --markdown directiveops-report.md
```

Run a sanitized report suitable for sharing:

```bash
directiveops-scanner scan --path . --markdown report.md --sanitize
```

### Config example (`directiveops.config.json`)

Place a `directiveops.config.json` at the repo root to control local baseline behavior:

```json
{
  "additionalInstructionPaths": [
    "docs/AGENTS.md"
  ],
  "requiredCategories": [
    "testing",
    "security"
  ],
  "allowRemoteHosts": [
    "github.com"
  ],
  "baselineDirectives": [
    {
      "key": "testing:all-prs-must-run-tests",
      "category": "testing",
      "normalizedText": "all pull requests must run tests in ci"
    }
  ]
}
```

### Sample JSON output

```json
{
  "rootDir": ".",
  "repositoryName": "example-repo",
  "scannedAt": "2026-03-16T12:34:56.000Z",
  "discoveredFiles": ["AGENTS.md", ".github/copilot-instructions.md"],
  "summary": {
    "instructionFileCount": 2,
    "directiveCount": 18,
    "findingCount": 3,
    "highSeverityCount": 1,
    "driftScore": 30,
    "conflictCount": 1
  },
  "findings": [
    {
      "type": "risky-import",
      "severity": "high",
      "summary": "Remote instruction import is outside the approved source set",
      "affectedFiles": ["AGENTS.md"],
      "affectedScope": "repository"
    }
  ]
}
```

### Sample Markdown report (excerpt)

```markdown
# DirectiveOps OSS Scanner Report

- Repository: example-repo
- Scanned at: 2026-03-16T12:34:56.000Z
- Instruction files discovered: 2
- Directives extracted: 18
- Basic findings: 3
- High severity findings: 1
- Drift score: 30
- Conflicting instructions: 1

## Discovered Files
- `AGENTS.md`
- `.github/copilot-instructions.md`

## Findings
- [HIGH] Remote instruction import is outside the approved source set (AGENTS.md)
```

### OSS vs hosted boundary

- **This repository (OSS Scanner)**:
  - Local CLI only
  - Discovers instruction files in a single repository
  - Parses them into a normalized constitution model
  - Runs a basic findings engine (conflicts, risky imports, stale references, required directives, local drift)
  - Emits JSON and Markdown reports
- **Hosted DirectiveOps** (separate product):
  - Central multi-repo inventory and dashboards
  - Org-level templates and policy rules
  - Rollout preview and PR generation
  - History, audit, and collaboration features


