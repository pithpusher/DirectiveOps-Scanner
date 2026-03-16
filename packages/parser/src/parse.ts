import {
  inferPrecedence,
  summarizeDirectiveKey,
  type ConstitutionGraph,
  type ConstitutionLayer,
  type DirectiveCategory,
  type DirectiveConflict,
  type InstructionReference,
  type NormalizedDirective,
  type NormalizedInstructionFile,
  type OwnershipReference,
  type ValidationMessage
} from "@directiveops/constitution-model";
import { inferDirectiveCategory, inferDirectiveStrength } from "./categories";
import { detectInstructionFileType, detectParserKind, inferScope } from "./file-types";
import { extractMetadata, extractSections, makeLocation, toExtractionMethod } from "./markdown";

export interface ParseInstructionInput {
  organizationId: string;
  repositoryId: string;
  path: string;
  content: string;
}

export interface BuildConstitutionInput {
  organizationId: string;
  repositoryId: string;
  repositoryName: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}

const imperativePattern = /\b(always|never|must|should|prefer|avoid|keep|use|document|required|do not)\b/i;

function normalizeDirectiveText(text: string): string {
  return text
    .replace(/^[-*]\s*/, "")
    .replace(/\.$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractImports(path: string, content: string): InstructionReference[] {
  const metadata = extractMetadata(content);
  return metadata.imports.map((target, index) => ({
    target,
    targetType: /^https?:\/\//.test(target) ? "url" : target.endsWith(".md") ? "file" : "unknown",
    relationship: path === "CLAUDE.md" ? "extends" : "imports",
    location: makeLocation(index + 1),
    extractionMethod: target.endsWith(".md") || /^https?:\/\//.test(target) ? "deterministic" : "heuristic"
  }));
}

function extractDirectives(
  content: string,
  sections = extractSections(content),
  owners: OwnershipReference[],
  scope: ReturnType<typeof inferScope>
): NormalizedDirective[] {
  const lines = content.split(/\r?\n/);
  const directives: NormalizedDirective[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || /^#/.test(trimmed) || /^Scope:/i.test(trimmed) || /^Owners?:/i.test(trimmed) || /^Imports?:/i.test(trimmed)) {
      return;
    }

    const isBullet = /^[-*]\s+/.test(trimmed);
    const isImperativeSentence = imperativePattern.test(trimmed);

    if (!isBullet && !isImperativeSentence) {
      return;
    }

    const normalizedText = normalizeDirectiveText(trimmed);
    const category = inferDirectiveCategory(normalizedText);
    const section = sections.find(
      (candidate) => index + 1 >= candidate.location.lineStart && index + 1 <= candidate.location.lineEnd
    );
    const confidence = isBullet ? 0.95 : 0.72;

    directives.push({
      id: `directive-${index + 1}-${normalizedText.slice(0, 24).replace(/[^a-z0-9]+/g, "-")}`,
      key: summarizeDirectiveKey(category, normalizedText),
      rawText: trimmed,
      normalizedText,
      category,
      strength: inferDirectiveStrength(trimmed),
      scope,
      tags: buildTags(category, normalizedText),
      owners,
      appliesTo: inferAppliesTo(section?.path ?? []),
      extractionMethod: toExtractionMethod(confidence),
      confidence,
      location: makeLocation(index + 1),
      sourceSectionId: section?.id,
      metadata: buildDirectiveMetadata(trimmed, category)
    });
  });

  return directives;
}

function buildTags(category: DirectiveCategory, text: string): string[] {
  const tags = new Set<string>([category]);
  if (/\bpull request\b/i.test(text)) {
    tags.add("pull-request");
  }
  if (/\bsecret\b|\btoken\b/i.test(text)) {
    tags.add("secret-handling");
  }
  if (/\boverride\b/i.test(text)) {
    tags.add("override");
  }
  return [...tags];
}

function inferAppliesTo(sectionPath: string[]): string[] {
  if (sectionPath.length === 0) {
    return ["repository"];
  }
  return sectionPath.map((segment) => segment.toLowerCase());
}

function buildDirectiveMetadata(text: string, category: DirectiveCategory): Record<string, string | boolean> {
  const lower = text.toLowerCase();
  return {
    categoryHint: category,
    negativePolarity: /\b(never|do not|avoid)\b/.test(lower),
    positivePolarity: /\b(always|must|required|keep)\b/.test(lower)
  };
}

export function parseInstructionFile(input: ParseInstructionInput): NormalizedInstructionFile {
  const fileType = detectInstructionFileType(input.path);
  const parserKind = detectParserKind(input.path);
  const sections = extractSections(input.content);
  const metadata = extractMetadata(input.content);
  const scope = inferScope(input.path, metadata.scope);
  const imports = extractImports(input.path, input.content);
  const directives = extractDirectives(input.content, sections, metadata.owners, scope);
  const validation: ValidationMessage[] = [];

  if (directives.length === 0) {
    validation.push({
      level: "warning",
      source: "parser",
      message: "No likely directives were extracted from this file."
    });
  }

  if (!metadata.scope) {
    validation.push({
      level: "warning",
      source: "parser",
      message: "Scope was inferred from the file path because no explicit Scope metadata was present."
    });
  }

  const parserConfidence = directives.length > 0 ? Math.max(0.7, average(directives.map((directive) => directive.confidence))) : 0.55;

  return {
    id: `${input.repositoryId}:${input.path}`,
    repositoryId: input.repositoryId,
    path: input.path,
    fileType,
    parserKind,
    scope,
    precedence: inferPrecedence(fileType, input.path),
    rawContent: input.content,
    sections,
    imports,
    directives,
    tags: [...new Set(directives.flatMap((directive) => directive.tags))],
    owners: metadata.owners,
    validation,
    parserConfidence,
    status: "active"
  };
}

export function buildConstitutionGraph(input: BuildConstitutionInput): ConstitutionGraph {
  const sourceFiles = input.files
    .map((file) =>
      parseInstructionFile({
        organizationId: input.organizationId,
        repositoryId: input.repositoryId,
        path: file.path,
        content: file.content
      })
    )
    .sort((left, right) => right.precedence - left.precedence);

  const localPaths = new Set(sourceFiles.map((file) => file.path));
  const layers: ConstitutionLayer[] = sourceFiles.map((file, index) => ({
    id: `${input.repositoryId}:layer:${index + 1}`,
    repositoryId: input.repositoryId,
    organizationId: input.organizationId,
    scope: file.scope,
    precedence: file.precedence,
    sourceFileIds: [file.id],
    inheritedLayerIds: file.imports
      .filter((entry) => entry.targetType === "file" && localPaths.has(entry.target))
      .map((entry) => `${input.repositoryId}:layer:${sourceFiles.findIndex((candidate) => candidate.path === entry.target) + 1}`)
      .filter(Boolean),
    imports: file.imports.map((entry) => ({
      ...entry,
      existsInRepository: entry.targetType === "file" ? localPaths.has(entry.target) : undefined
    })),
    directives: file.directives,
    tags: file.tags,
    owners: file.owners,
    validation: file.validation,
    status: file.status
  }));

  const directiveConflicts = detectDirectiveConflicts(sourceFiles);
  const conflictMessages: ValidationMessage[] = directiveConflicts.map((conflict) => ({
    level: "warning",
    source: "parser",
    message: `Conflicting directives for key ${conflict.key} across files: ${conflict.filePaths.join(", ")}`
  }));

  return {
    constitutionId: `constitution:${input.repositoryId}`,
    repositoryId: input.repositoryId,
    organizationId: input.organizationId,
    versionLabel: `v${new Date().toISOString().slice(0, 10)}`,
    layers,
    sourceFiles,
    validation: [...layers.flatMap((layer) => layer.validation), ...conflictMessages],
    createdAt: new Date().toISOString()
  };
}

function detectDirectiveConflicts(files: NormalizedInstructionFile[]): DirectiveConflict[] {
  const byKey = new Map<
    string,
    {
      category: DirectiveCategory;
      scope: string;
      entries: Array<{ directiveId: string; filePath: string; normalizedText: string }>;
    }
  >();

  for (const file of files) {
    for (const directive of file.directives) {
      const existing = byKey.get(directive.key);
      if (!existing) {
        byKey.set(directive.key, {
          category: directive.category,
          scope: directive.scope,
          entries: [{ directiveId: directive.id, filePath: file.path, normalizedText: directive.normalizedText }]
        });
        continue;
      }

      existing.entries.push({
        directiveId: directive.id,
        filePath: file.path,
        normalizedText: directive.normalizedText
      });
    }
  }

  const conflicts: DirectiveConflict[] = [];

  byKey.forEach((value, key) => {
    const distinctTexts = new Set(value.entries.map((entry) => entry.normalizedText));
    if (value.entries.length > 1 && distinctTexts.size > 1) {
      conflicts.push({
        key,
        category: value.category,
        scope: (value.scope as unknown) as any,
        directiveIds: value.entries.map((entry) => entry.directiveId),
        filePaths: Array.from(new Set(value.entries.map((entry) => entry.filePath)))
      });
    }
  });

  return conflicts;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

