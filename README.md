# DirectiveOps Scanner

DirectiveOps Scanner is an open-source CLI for scanning `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, GitHub Copilot instructions, Cursor rules, NemoClaw/OpenShell policy yaml, and related AI coding agent instruction and policy files in a repository.

It helps engineering teams discover instruction files, normalize directives, detect drift or conflicts, and export JSON or Markdown reports. The free scanner is built for local repository analysis. Teams that need multi-repo visibility, rollout workflows, dashboards, policy management, and audit history should use the hosted product at [DirectiveOps](https://www.directiveops.dev/).

## What it does

- Scans common AI instruction files such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.cursor/rules`, and `AI.md`
- Normalizes extracted instructions into a constitution-style model
- Detects basic drift, conflict, risky import, stale reference, and required-directive findings
- Exports machine-readable JSON and human-readable Markdown reports
- Supports local baselines through `directiveops.config.json`

## Who it is for

- Platform and developer experience teams auditing AI coding assistant instructions
- Security and governance teams reviewing prompt and policy drift
- Repository owners who want a free local scanner before adopting central controls
- Teams comparing `AGENTS.md`, Copilot instructions, and other agent-specific instruction files

## Why teams use it

- Find all AI coding instruction files in a repo quickly
- Detect conflicting or risky instructions before they spread
- Standardize how agent instructions are analyzed across repositories
- Generate reports that can be shared in issues, PRs, or internal reviews
- Start with the free scanner, then move to [DirectiveOps](https://www.directiveops.dev/) for centralized governance and paid workflows

## What it scans

By default, the scanner discovers:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`
- `.cursor/rules` or `.cursor/rules.md`
- `.windsurf/*.md`
- `.github/copilot.yaml` and `copilot.yaml`
- `nemoclaw.yaml`, `nemoclaw.yml`, `openshell-policy.yaml`
- `inference-profiles.yaml` / `inference-profiles.yml`
- `policies/*.yaml`
- `SOUL.md`, `TOOLS.md`, `MEMORY.md`
- `AI.md`, `AI-RULES.md`
- Any additional paths configured in `directiveops.config.json`

## What it produces

- JSON output: a `ScannerResult` containing discovered files, a normalized constitution graph, findings, summary counts, and a drift score
- Markdown report: a human-readable summary suitable for sharing or attaching to issues, with optional sanitization

## Installation

From npm:

```bash
npm install -g @directiveops/scanner-cli
```

From source:

```bash
npm install
npm run build
npx directiveops-scanner scan --path .
```

## Quickstart

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

## Common use cases

### Audit AI instruction files in a repository

Use DirectiveOps Scanner to inventory agent instruction files and see what guidance different tools are receiving.

### Detect prompt or policy drift

Run the scanner against a repo baseline to flag required directives, conflicts, risky imports, and basic drift between code-level instructions and runtime policies such as NemoClaw/OpenShell yaml or Copilot configs.

### Generate compliance-style reports

Export JSON for tooling or Markdown for human review in pull requests and issues.

### Evaluate the free scanner before moving to hosted governance

Use the local CLI for repository-level analysis, then adopt [DirectiveOps](https://www.directiveops.dev/) when you need org-wide visibility, controls, and rollout workflows.

## Config example (`directiveops.config.json`)

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

## Sample JSON output

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

## Sample Markdown report

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

## OSS scanner vs hosted DirectiveOps

### This repository: free OSS scanner

- Local CLI for scanning one repository at a time
- Discovers and parses AI instruction files
- Builds a normalized constitution model
- Runs a basic findings engine for drift, conflicts, risky imports, stale references, and missing required directives
- Emits JSON and Markdown reports

### DirectiveOps: hosted paid product

- Central multi-repo inventory and dashboards
- Org-level templates and policy rules
- Rollout preview and PR generation
- Drift tracking and audit history
- Team collaboration, RBAC, and exception workflows

If you are evaluating the free scanner and need governance across repositories, use [DirectiveOps](https://www.directiveops.dev/) as the next step.

## Related files

- [Example config](./examples/directiveops.config.json)
- [Example report](./examples/report.md)
- [Example repo with `AGENTS.md`](./examples/simple-repo/AGENTS.md)

## Keywords

AI instruction file scanner, `AGENTS.md` scanner, `CLAUDE.md` scanner, `GEMINI.md` scanner, GitHub Copilot instruction scanner, Cursor rules scanner, NemoClaw policy yaml scanner, OpenShell policy scanner, prompt governance, instruction drift detection, policy drift scanner, repository compliance scanner, developer tooling CLI.
