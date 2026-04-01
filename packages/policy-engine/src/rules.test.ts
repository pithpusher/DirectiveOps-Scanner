import test from "node:test";
import assert from "node:assert/strict";
import { buildConstitutionGraph } from "@directiveops/parser";
import type { PolicyRule } from "@directiveops/oss-types";
import { evaluatePolicies } from "./rules";

test("required-content emits missing-required-content when substring absent", () => {
  const constitution = buildConstitutionGraph({
    organizationId: "org",
    repositoryId: "repo",
    repositoryName: "repo",
    files: [{ path: "AGENTS.md", content: "# A\n\n- Keep it simple.\n" }]
  });

  const rule: PolicyRule = {
    id: "r1",
    organizationId: "org",
    code: "TEST-CONTENT-1",
    name: "Require phrase",
    description: "Must contain phrase.",
    type: "required-content",
    severity: "medium",
    enabled: true,
    config: {
      contentRuleId: "need-phrase",
      label: "magic phrase",
      contains: "MAGIC_PHRASE_XYZ"
    }
  };

  const findings = evaluatePolicies({
    organizationId: "org",
    repositoryId: "repo",
    constitution,
    policyRules: [rule],
    baselineDirectives: [],
    repoOverrides: []
  });

  assert.equal(
    findings.some((finding) => finding.type === "missing-required-content" && finding.policyRuleCode === "TEST-CONTENT-1"),
    true
  );
});

test("required-content passes when substring present across files", () => {
  const constitution = buildConstitutionGraph({
    organizationId: "org",
    repositoryId: "repo",
    repositoryName: "repo",
    files: [
      { path: "AGENTS.md", content: "- Use pnpm test\n" },
      { path: "CLAUDE.md", content: "# Extra\n" }
    ]
  });

  const rule: PolicyRule = {
    id: "r2",
    organizationId: "org",
    code: "TEST-CONTENT-2",
    name: "pnpm",
    description: "pnpm test",
    type: "required-content",
    severity: "low",
    enabled: true,
    config: {
      contentRuleId: "pnpm",
      label: "pnpm test",
      contains: "pnpm test"
    }
  };

  const findings = evaluatePolicies({
    organizationId: "org",
    repositoryId: "repo",
    constitution,
    policyRules: [rule],
    baselineDirectives: [],
    repoOverrides: []
  });

  assert.equal(findings.some((finding) => finding.type === "missing-required-content"), false);
});

test("required-content respects pathPatterns scoping", () => {
  const constitution = buildConstitutionGraph({
    organizationId: "org",
    repositoryId: "repo",
    repositoryName: "repo",
    files: [
      { path: "AGENTS.md", content: "- Keep AGENTS clean.\n" },
      { path: "CLAUDE.md", content: "- Use CLAUDE here.\nMAGIC_PHRASE_XYZ\n" }
    ]
  });

  const rule: PolicyRule = {
    id: "r-path",
    organizationId: "org",
    code: "TEST-PATH-1",
    name: "Phrase in AGENTS only",
    description: "Test",
    type: "required-content",
    severity: "medium",
    enabled: true,
    config: {
      contentRuleId: "magic",
      label: "magic",
      contains: "MAGIC_PHRASE_XYZ",
      pathPatterns: ["AGENTS.md"]
    }
  };

  const findings = evaluatePolicies({
    organizationId: "org",
    repositoryId: "repo",
    constitution,
    policyRules: [rule],
    baselineDirectives: [],
    repoOverrides: []
  });

  assert.equal(
    findings.some((finding) => finding.type === "missing-required-content" && finding.affectedFiles.includes("AGENTS.md")),
    true
  );
  assert.equal(
    findings.some((finding) => finding.type === "missing-required-content" && finding.affectedFiles.includes("CLAUDE.md")),
    false
  );
});

test("required-directive explanation lists only missing categories", () => {
  const constitution = buildConstitutionGraph({
    organizationId: "org",
    repositoryId: "repo",
    repositoryName: "repo",
    files: [
      {
        path: "AGENTS.md",
        content: "## Security\n\n- Never commit secrets.\n"
      }
    ]
  });

  const rule: PolicyRule = {
    id: "r3",
    organizationId: "org",
    code: "TEST-REQ-1",
    name: "Security and testing",
    description: "Both categories required.",
    type: "required-directive",
    severity: "high",
    enabled: true,
    config: {
      categories: ["security", "testing"]
    }
  };

  const findings = evaluatePolicies({
    organizationId: "org",
    repositoryId: "repo",
    constitution,
    policyRules: [rule],
    baselineDirectives: [],
    repoOverrides: []
  });

  const finding = findings.find((entry) => entry.type === "missing-required-directive");
  assert.ok(finding);
  assert.ok(finding.explanation.includes("testing"));
  assert.ok(!finding.explanation.includes("security"));
});
