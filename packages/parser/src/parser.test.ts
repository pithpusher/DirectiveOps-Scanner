import test from "node:test";
import assert from "node:assert/strict";
import { parseInstructionFile } from "./parse";

const baseInput = {
  organizationId: "org",
  repositoryId: "repo"
};

test("numbered list line is extracted as a directive", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `# Rules\n\n1. Always run tests before merging.\n`
  });
  assert.equal(file.directives.length, 1);
  const d0 = file.directives[0];
  assert.ok(d0);
  assert.ok(d0.normalizedText.includes("always run tests"));
});

test("section heading supplies category when line text is unknown", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `# Guide\n\n## Security requirements\n\n- Rotate keys quarterly.\n`
  });
  assert.equal(file.directives.length, 1);
  const d0 = file.directives[0];
  assert.ok(d0);
  assert.equal(d0.category, "security");
  assert.equal(d0.metadata?.categorySource, "section");
});

test("line keywords win over section when both apply", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `# Misc\n\n## Observability\n\n- Never log a production secret in plain text.\n`
  });
  const d0 = file.directives[0];
  assert.ok(d0);
  assert.equal(d0.category, "security");
  assert.equal(d0.metadata?.categorySource, "text");
});

test("lines inside fenced code blocks are not extracted as directives", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `# Rules\n\n- Always run tests.\n\n\`\`\`bash\n- rm -rf /\nMust should prefer\n\`\`\`\n\n- Document changes in the changelog.\n`
  });
  assert.equal(file.directives.length, 2);
  assert.ok(file.directives.some((d) => d.normalizedText.includes("always run tests")));
  assert.ok(file.directives.some((d) => d.normalizedText.includes("document changes")));
});

test("tilde fences are skipped", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `~~~\n- fake bullet\n~~~\n\n- Real directive.\n`
  });
  assert.equal(file.directives.length, 1);
  assert.ok(file.directives[0]?.normalizedText.includes("real directive"));
});

test("blockquote lines are treated as directives", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `# R\n\n> Always run tests before opening a pull request.\n`
  });
  assert.equal(file.directives.length, 1);
  assert.ok(file.directives[0]?.rawText.startsWith(">"));
  assert.ok(file.directives[0]?.normalizedText.includes("always run tests"));
});

test("nested blockquote prefix is stripped", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `> > Must document breaking changes.\n`
  });
  assert.equal(file.directives.length, 1);
});

test("indented code block lines are skipped", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `## Example\n\n    npm run build\n    must should prefer\n\n- Real bullet.\n`
  });
  assert.equal(file.directives.length, 1);
  assert.ok(file.directives[0]?.normalizedText.includes("real bullet"));
});

test("YAML front matter exposes directiveops and offsets line numbers", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `---
directiveops:
  version: 1
  imports:
    - other.md
---

## Rules

- Always run tests.\n`
  });
  assert.ok(file.directiveopsMetadata?.version === 1);
  assert.ok(file.imports.some((i) => i.target === "other.md"));
  assert.equal(file.directives[0]?.location.lineStart, 10);
});

test("markdown autolink reference is merged into imports", () => {
  const file = parseInstructionFile({
    ...baseInput,
    path: "AGENTS.md",
    content: `See <docs/guide.md> for details.\n`
  });
  assert.ok(file.imports.some((i) => i.target === "docs/guide.md"));
});
