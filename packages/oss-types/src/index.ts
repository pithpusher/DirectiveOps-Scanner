export type FindingSeverity = "low" | "medium" | "high" | "critical";

export interface DriftFinding {
  id: string;
  organizationId: string;
  repositoryId: string;
  status: "open" | "resolved";
  type: string;
  severity: FindingSeverity;
  summary: string;
  explanation: string;
  affectedFiles: string[];
  affectedScope: string;
  suggestedRemediation?: string;
  policyRuleCode?: string;
}

export interface PolicyRule {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string;
  type: string;
  severity: FindingSeverity;
  enabled: boolean;
  // free-form config for rule-specific options
  config: Record<string, unknown>;
}

export interface RepoOverride {
  id: string;
  organizationId: string;
  repositoryId: string;
  pathPattern: string;
}

