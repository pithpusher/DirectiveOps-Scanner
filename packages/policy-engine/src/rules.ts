import type { ConstitutionGraph, NormalizedDirective, NormalizedInstructionFile } from "@directiveops/constitution-model";
import type { DriftFinding, PolicyRule, RepoOverride } from "@directiveops/oss-types";

export interface EvaluatePoliciesInput {
  organizationId: string;
  repositoryId: string;
  constitution: ConstitutionGraph;
  policyRules: PolicyRule[];
  baselineDirectives: Array<{
    key: string;
    category: string;
    normalizedText: string;
  }>;
  repoOverrides: RepoOverride[];
}

export interface RuleContext extends EvaluatePoliciesInput {
  directives: NormalizedDirective[];
  sourceFiles: NormalizedInstructionFile[];
}

export type RuleEvaluator = (context: RuleContext) => DriftFinding[];

export const DEFAULT_RULE_EVALUATORS: RuleEvaluator[] = [
  evaluateRequiredDirectives,
  evaluateDuplicateDirectives,
  evaluateConflicts,
  evaluateStaleReferences,
  evaluateRiskyImports,
  evaluateOrgDrift,
  evaluateUndocumentedOverrides,
  evaluateScopeContradictions,
  evaluateCircularReferences
];

export interface EvaluatePoliciesOptions {
  evaluators?: RuleEvaluator[];
}

export function evaluatePolicies(
  input: EvaluatePoliciesInput,
  options?: EvaluatePoliciesOptions
): DriftFinding[] {
  const context: RuleContext = {
    ...input,
    directives: input.constitution.layers.flatMap((layer) => layer.directives),
    sourceFiles: input.constitution.sourceFiles
  };

  const evaluators = options?.evaluators ?? DEFAULT_RULE_EVALUATORS;
  return evaluators.flatMap((rule) => rule(context));
}

function evaluateRequiredDirectives(context: RuleContext): DriftFinding[] {
  return context.policyRules
    .filter((rule) => rule.enabled && rule.type === "required-directive")
    .flatMap((rule) => {
      const requiredCategories = Array.isArray(rule.config.categories) ? (rule.config.categories as string[]) : [];
      const matches = requiredCategories.every((category) =>
        context.directives.some((directive) => directive.category === category)
      );

      if (matches) {
        return [];
      }

      return [
        buildFinding(context, {
          type: "missing-required-directive",
          severity: rule.severity,
          summary: "Required directive coverage is incomplete",
          explanation: `This repository instruction set is missing one or more required directive categories: ${requiredCategories.join(", ")}.`,
          affectedFiles: context.sourceFiles.map((file) => file.path),
          affectedScope: "repository",
          suggestedRemediation: "Add the missing directive to a repository-level instruction file or align with your chosen baseline template.",
          policyRuleCode: rule.code
        })
      ];
    });
}

function evaluateDuplicateDirectives(context: RuleContext): DriftFinding[] {
  const buckets = new Map<string, NormalizedDirective[]>();

  context.directives.forEach((directive) => {
    const key = directive.normalizedText;
    const existing = buckets.get(key) ?? [];
    existing.push(directive);
    buckets.set(key, existing);
  });

  return [...buckets.entries()]
    .filter(([, directives]) => directives.length > 1)
    .map(([normalizedText, directives]) =>
      buildFinding(context, {
        type: "duplicate",
        severity: "low",
        summary: "Directive is repeated across instruction layers",
        explanation: `The directive "${normalizedText}" appears ${directives.length} times across the instruction set, which can obscure precedence.`,
        affectedFiles: distinctSourcePaths(context.sourceFiles, directives),
        affectedScope: directives[0]?.scope ?? "repository",
        suggestedRemediation: "Keep the directive in the highest-precedence source and remove duplicated wording elsewhere."
      })
    );
}

function evaluateConflicts(context: RuleContext): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const left of context.directives) {
    for (const right of context.directives) {
      if (left.id >= right.id) {
        continue;
      }

      if (left.category !== right.category) {
        continue;
      }

      const leftNormalized = stripPolarity(left.normalizedText);
      const rightNormalized = stripPolarity(right.normalizedText);
      const polarityMismatch = polarity(left) !== polarity(right);
      const sameIntent = overlapRatio(leftNormalized, rightNormalized) > 0.6;

      if (!polarityMismatch || !sameIntent) {
        continue;
      }

      findings.push(
        buildFinding(context, {
          type: "conflict",
          severity: "high",
          summary: "Conflicting directives govern the same behavior",
          explanation: `Two directives appear to control the same behavior with opposite polarity: "${left.rawText}" and "${right.rawText}".`,
          affectedFiles: distinctSourcePaths(context.sourceFiles, [left, right]),
          affectedScope: left.scope,
          suggestedRemediation: "Resolve the contradiction in the higher-precedence source and remove the conflicting lower-precedence directive."
        })
      );
    }
  }

  return dedupeFindings(findings);
}

function evaluateStaleReferences(context: RuleContext): DriftFinding[] {
  return context.sourceFiles.flatMap((file) =>
    file.imports
      .filter(
        (entry) =>
          entry.targetType === "file" &&
          entry.target !== file.path &&
          !context.sourceFiles.some((candidate) => candidate.path === entry.target)
      )
      .map((entry) =>
        buildFinding(context, {
          type: "stale-reference",
          severity: "medium",
          summary: "Instruction file imports a missing local file",
          explanation: `${file.path} imports ${entry.target}, but that file was not discovered in this repository scan.`,
          affectedFiles: [file.path],
          affectedScope: file.scope,
          suggestedRemediation: "Remove the missing import or restore the referenced file in the repository."
        })
      )
  );
}

function evaluateRiskyImports(context: RuleContext): DriftFinding[] {
  const policy = context.policyRules.find((rule) => rule.enabled && rule.type === "risky-import");
  const allowRemoteHosts = Array.isArray(policy?.config.allowRemoteHosts)
    ? (policy.config.allowRemoteHosts as string[])
    : [];

  return context.sourceFiles.flatMap((file) =>
    file.imports
      .filter((entry) => entry.targetType === "url")
      .filter((entry) => !allowRemoteHosts.some((host) => entry.target.includes(host)))
      .map((entry) =>
        buildFinding(context, {
          type: "risky-import",
          severity: policy?.severity ?? "critical",
          summary: "Remote instruction import is outside the approved source set",
          explanation: `${file.path} imports ${entry.target}, which weakens source control and auditability for this instruction set.`,
          affectedFiles: [file.path],
          affectedScope: file.scope,
          suggestedRemediation: "Move the referenced instructions into the repository or replace them with an approved baseline template.",
          policyRuleCode: policy?.code
        })
      )
  );
}

function evaluateOrgDrift(context: RuleContext): DriftFinding[] {
  return context.baselineDirectives.flatMap((baseline) => {
    const matchingDirective = context.directives.find(
      (directive) =>
        directive.category === baseline.category &&
        overlapRatio(directive.normalizedText, baseline.normalizedText) > 0.65
    );

    if (matchingDirective) {
      return [];
    }

    return [
      buildFinding(context, {
        type: "org-drift",
        severity: "medium",
        summary: "Repository instruction set is missing a baseline directive",
        explanation: `The expected baseline directive "${baseline.normalizedText}" is not present in this repository instruction set.`,
        affectedFiles: context.sourceFiles.map((file) => file.path),
        affectedScope: "repository",
        suggestedRemediation: "Align the repository instructions with your chosen baseline template.",
        policyRuleCode: "POL-005"
      })
    ];
  });
}

function evaluateUndocumentedOverrides(context: RuleContext): DriftFinding[] {
  return context.directives
    .filter((directive) => directive.tags.includes("override"))
    .filter(
      (directive) =>
        !context.repoOverrides.some((override) =>
          directive.rawText.toLowerCase().includes(override.pathPattern.toLowerCase())
        )
    )
    .map((directive) =>
      buildFinding(context, {
        type: "undocumented-override",
        severity: "high",
        summary: "Local override is not recorded as an approved override",
        explanation: `Directive "${directive.rawText}" looks like a local override, but no matching approved override record exists.`,
        affectedFiles: distinctSourcePaths(context.sourceFiles, [directive]),
        affectedScope: directive.scope,
        suggestedRemediation: "Record this override in your governance process or remove the repo-specific exception."
      })
    );
}

function evaluateScopeContradictions(context: RuleContext): DriftFinding[] {
  return context.sourceFiles.flatMap((file) => {
    const explicitScopeMatch = /^Scope:\s*(.+)$/im.exec(file.rawContent);
    const explicitScopeValue = explicitScopeMatch?.[1];
    if (!explicitScopeValue) {
      return [];
    }

    const explicitScope = explicitScopeValue.trim().toLowerCase();
    const pathSuggestsDirectory = file.path.startsWith(".github/instructions/");

    if (pathSuggestsDirectory && explicitScope !== "directory") {
      return [
        buildFinding(context, {
          type: "scope-contradiction",
          severity: "medium",
          summary: "File path and declared scope do not match",
          explanation: `${file.path} sits under .github/instructions/ but declares Scope: ${explicitScope}.`,
          affectedFiles: [file.path],
          affectedScope: explicitScope,
          suggestedRemediation: "Align the declared scope with the file location or move the file to the appropriate path."
        })
      ];
    }

    return [];
  });
}

function evaluateCircularReferences(context: RuleContext): DriftFinding[] {
  const adjacency = new Map<string, string[]>();

  context.sourceFiles.forEach((file) => {
    adjacency.set(
      file.path,
      file.imports
        .filter(
          (entry) =>
            entry.targetType === "file" &&
            entry.target !== file.path &&
            context.sourceFiles.some((candidate) => candidate.path === entry.target)
        )
        .map((entry) => entry.target)
    );
  });

  const findings = new Set<string>();

  for (const start of adjacency.keys()) {
    visit(start, start, []);
  }

  return [...findings].map((cycle) =>
    buildFinding(context, {
      type: "circular-reference",
      severity: "high",
      summary: "Circular instruction import chain detected",
      explanation: `The instruction import graph contains a cycle: ${cycle}.`,
      affectedFiles: cycle.split(" -> ").slice(0, -1),
      affectedScope: "repository",
      suggestedRemediation: "Collapse the shared directives into a single higher-precedence source or remove one side of the cycle."
    })
  );

  function visit(node: string, target: string, trail: string[]): void {
    const nextTrail = [...trail, node];
    for (const neighbor of adjacency.get(node) ?? []) {
      if (neighbor === target && nextTrail.length > 1) {
        findings.add([...nextTrail, neighbor].join(" -> "));
        continue;
      }

      if (nextTrail.includes(neighbor)) {
        continue;
      }

      visit(neighbor, target, nextTrail);
    }
  }
}

function buildFinding(
  context: RuleContext,
  finding: Omit<DriftFinding, "id" | "organizationId" | "repositoryId" | "status">
): DriftFinding {
  const fingerprintSource = JSON.stringify({
    type: finding.type,
    severity: finding.severity,
    summary: finding.summary,
    explanation: finding.explanation,
    affectedFiles: [...finding.affectedFiles].sort(),
    affectedScope: finding.affectedScope,
    policyRuleCode: finding.policyRuleCode ?? null
  });
  return {
    id: `finding:${context.repositoryId}:${finding.type}:${hash(fingerprintSource)}`,
    organizationId: context.organizationId,
    repositoryId: context.repositoryId,
    status: "open",
    ...finding
  };
}

function distinctSourcePaths(sourceFiles: NormalizedInstructionFile[], directives: NormalizedDirective[]): string[] {
  return sourceFiles
    .filter((file) => file.directives.some((directive) => directives.includes(directive)))
    .map((file) => file.path);
}

function polarity(directive: NormalizedDirective): "positive" | "negative" | "neutral" {
  const negative = directive.metadata?.negativePolarity === true;
  const positive = directive.metadata?.positivePolarity === true;
  if (negative && !positive) {
    return "negative";
  }
  if (positive && !negative) {
    return "positive";
  }
  return "neutral";
}

function stripPolarity(text: string): string {
  return text
    .replace(/\b(always|never|must|should|prefer|avoid|required|do not|keep)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function overlapRatio(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size, 1);
}

function dedupeFindings(findings: DriftFinding[]): DriftFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.type}:${finding.summary}:${finding.affectedFiles.join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hash(value: string): string {
  let output = 0;
  for (let index = 0; index < value.length; index += 1) {
    output = (output << 5) - output + value.charCodeAt(index);
    output |= 0;
  }
  return Math.abs(output).toString(16);
}

