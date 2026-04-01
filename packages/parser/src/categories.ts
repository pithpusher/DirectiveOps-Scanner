import type { DirectiveCategory, DirectiveStrength } from "@directiveops/constitution-model";

const categoryMap: Array<{ category: DirectiveCategory; patterns: RegExp[] }> = [
  {
    category: "testing",
    patterns: [/\btest\b/i, /\btests\b/i, /\bintegration\b/i, /\bunit\b/i, /\blint\b/i, /\bci\b/i]
  },
  {
    category: "security",
    patterns: [
      /\bsecret\b/i,
      /\bsecurity\b/i,
      /\btoken\b/i,
      /\bcredential\b/i,
      /\bscan\b/i,
      /\bpii\b/i,
      /\bsoc2\b/i,
      /\bvulnerability\b/i
    ]
  },
  {
    category: "workflow",
    patterns: [/\bpull request\b/i, /\bmerge\b/i, /\bbranch\b/i, /\bworkflow\b/i]
  },
  {
    category: "documentation",
    patterns: [/\bdoc\b/i, /\bdocs\b/i, /\bdocument\b/i, /\bchangelog\b/i, /\bnote\b/i]
  },
  {
    category: "style",
    patterns: [/\bstyle\b/i, /\bformat\b/i, /\btyped\b/i, /\btypescript\b/i]
  },
  {
    category: "repo-conventions",
    patterns: [/\brepo\b/i, /\bconvention\b/i, /\blocal\b/i]
  },
  {
    category: "ownership",
    patterns: [/\bowner\b/i, /\bteam\b/i, /\bapprove\b/i]
  },
  {
    category: "release",
    patterns: [/\brelease\b/i, /\bdeploy\b/i, /\bmigration\b/i]
  },
  {
    category: "quality",
    patterns: [/\bobservability\b/i, /\bslo\b/i, /\bsli\b/i, /\bmetrics\b/i, /\bmonitoring\b/i, /\bquality\b/i]
  }
];

export type DirectiveCategorySource = "text" | "section" | "unknown";

export function inferDirectiveCategory(text: string): DirectiveCategory {
  for (const entry of categoryMap) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.category;
    }
  }
  return "unknown";
}

/** Normalize heading path segments and join for category keyword matching (same ordered map as line text). */
export function normalizeSectionPathForCategory(path: string[]): string {
  return path
    .map((segment) => segment.trim().toLowerCase().replace(/:\s*$/, ""))
    .filter(Boolean)
    .join(" > ");
}

export function inferDirectiveCategoryFromSectionPath(path: string[]): DirectiveCategory {
  if (path.length === 0) {
    return "unknown";
  }
  return inferDirectiveCategory(normalizeSectionPathForCategory(path));
}

export function mergeDirectiveCategory(
  normalizedDirectiveText: string,
  sectionPath: string[]
): { category: DirectiveCategory; categorySource: DirectiveCategorySource } {
  const textCategory = inferDirectiveCategory(normalizedDirectiveText);
  if (textCategory !== "unknown") {
    return { category: textCategory, categorySource: "text" };
  }
  const sectionCategory = inferDirectiveCategoryFromSectionPath(sectionPath);
  if (sectionCategory !== "unknown") {
    return { category: sectionCategory, categorySource: "section" };
  }
  return { category: "unknown", categorySource: "unknown" };
}

export function inferDirectiveStrength(text: string): DirectiveStrength {
  if (/\b(always|must|required)\b/i.test(text)) {
    return "must";
  }
  if (/\b(never|do not|avoid)\b/i.test(text)) {
    return "avoid";
  }
  if (/\b(should|prefer|keep)\b/i.test(text)) {
    return "should";
  }
  if (/\bmay\b/i.test(text)) {
    return "may";
  }
  return "unknown";
}

