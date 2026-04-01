import {
  inferPrecedence,
  summarizeDirectiveKey,
  type ConstitutionGraph,
  type ConstitutionLayer,
  type DirectiveCategory,
  type DirectiveConflict,
  type InstructionScope,
  type InstructionReference,
  type NormalizedDirective,
  type NormalizedInstructionFile,
  type OwnershipReference,
  type ValidationMessage
} from "@directiveops/constitution-model";
import { inferDirectiveStrength, mergeDirectiveCategory, type DirectiveCategorySource } from "./categories";
import { detectInstructionFileType, detectParserKind, inferScope } from "./file-types";
import { splitFrontMatter } from "./front-matter";
import { extractMetadata, extractInlineReferences, extractSections, makeLocation, toExtractionMethod } from "./markdown";

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

/** 0-based line indices inside fenced code blocks (opening, body, and closing fence lines). */
function lineIndicesInCodeFences(lines: string[]): Set<number> {
  const skip = new Set<number>();
  let inFence = false;
  let openLen = 0;
  let marker: "`" | "~" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);

    if (inFence) {
      skip.add(i);
      if (fenceMatch?.[1] && marker) {
        const fence = fenceMatch[1];
        const m = fence[0] as "`" | "~";
        if (m === marker && fence.length >= openLen) {
          inFence = false;
          marker = null;
          openLen = 0;
        }
      }
      continue;
    }

    if (fenceMatch?.[1]) {
      const fence = fenceMatch[1];
      marker = fence[0] as "`" | "~";
      openLen = fence.length;
      inFence = true;
      skip.add(i);
    }
  }

  return skip;
}

/** Indented CommonMark-style code blocks (4 spaces or tab). */
function lineIndicesInIndentedCodeBlocks(lines: string[]): Set<number> {
  const skip = new Set<number>();
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const isBlank = line.trim() === "";
    const isIndented = /^(?: {4}|\t)/.test(line);
    const isStart = /^(?: {4}\S|\t\S)/.test(line);

    if (!inBlock) {
      if (isStart) {
        inBlock = true;
        skip.add(i);
      }
    } else {
      if (!isBlank && !isIndented) {
        inBlock = false;
        continue;
      }
      skip.add(i);
    }
  }

  return skip;
}

function stripLeadingBlockquotes(line: string): string {
  let t = line.trim();
  while (/^>/.test(t)) {
    t = t.replace(/^>\s?/, "").trim();
  }
  return t;
}

function normalizeDirectiveText(text: string): string {
  return text
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\.$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractImports(path: string, content: string): InstructionReference[] {
  const metadata = extractMetadata(content);
  const targets = new Set(metadata.imports);
  for (const line of content.split(/\r?\n/)) {
    for (const t of extractInlineReferences(line)) {
      targets.add(t);
    }
  }
  return [...targets].map((target, index) => ({
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
  scope: ReturnType<typeof inferScope>,
  lineOffset = 0
): NormalizedDirective[] {
  const lines = content.split(/\r?\n/);
  const fenceSkip = lineIndicesInCodeFences(lines);
  const indentSkip = lineIndicesInIndentedCodeBlocks(lines);
  const directives: NormalizedDirective[] = [];

  lines.forEach((line, index) => {
    if (fenceSkip.has(index) || indentSkip.has(index)) {
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const unquoted = stripLeadingBlockquotes(trimmed);
    if (!unquoted) {
      return;
    }

    const metaLine = unquoted;
    if (
      /^#/.test(unquoted) ||
      /^Scope:/i.test(metaLine) ||
      /^Owners?:/i.test(metaLine) ||
      /^Imports?:/i.test(metaLine)
    ) {
      return;
    }

    const isBullet = /^[-*]\s+/.test(unquoted);
    const isNumbered = /^\d+\.\s+/.test(unquoted);
    const isImperativeSentence = imperativePattern.test(unquoted);

    if (!isBullet && !isNumbered && !isImperativeSentence) {
      return;
    }

    const normalizedText = normalizeDirectiveText(unquoted);
    const section = sections.find(
      (candidate) => index + 1 >= candidate.location.lineStart && index + 1 <= candidate.location.lineEnd
    );
    const sectionPath = section?.path ?? [];
    const { category, categorySource } = mergeDirectiveCategory(normalizedText, sectionPath);
    const baseConfidence = isBullet || isNumbered ? 0.95 : 0.72;
    const confidence = categorySource === "section" ? Math.min(0.85, baseConfidence) : baseConfidence;

    directives.push({
      id: `directive-${index + 1}-${normalizedText.slice(0, 24).replace(/[^a-z0-9]+/g, "-")}`,
      key: summarizeDirectiveKey(category, normalizedText),
      rawText: trimmed,
      normalizedText,
      category,
      strength: inferDirectiveStrength(unquoted),
      scope,
      tags: buildTags(category, normalizedText),
      owners,
      appliesTo: inferAppliesTo(sectionPath),
      extractionMethod: toExtractionMethod(confidence),
      confidence,
      location: makeLocation(index + 1 + lineOffset),
      sourceSectionId: section?.id,
      metadata: buildDirectiveMetadata(unquoted, category, categorySource)
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

function buildDirectiveMetadata(
  text: string,
  category: DirectiveCategory,
  categorySource: DirectiveCategorySource
): Record<string, string | boolean> {
  const lower = text.toLowerCase();
  return {
    categoryHint: category,
    categorySource,
    negativePolarity: /\b(never|do not|avoid)\b/.test(lower),
    positivePolarity: /\b(always|must|required|keep)\b/.test(lower)
  };
}

export function parseInstructionFile(input: ParseInstructionInput): NormalizedInstructionFile {
  const fileType = detectInstructionFileType(input.path);
  const parserKind = detectParserKind(input.path);
  const { body, lineOffset, directiveops } = splitFrontMatter(input.content);
  const sections = extractSections(body);
  const metadata = extractMetadata(body);
  const scope = inferScope(input.path, metadata.scope);
  const baseRefs = extractImports(input.path, body);
  const orderedTargets: string[] = [];
  const seenTargets = new Set<string>();
  for (const ref of baseRefs) {
    if (!seenTargets.has(ref.target)) {
      seenTargets.add(ref.target);
      orderedTargets.push(ref.target);
    }
  }
  if (directiveops?.imports && Array.isArray(directiveops.imports)) {
    for (const entry of directiveops.imports) {
      if (typeof entry === "string" && entry.trim()) {
        const t = entry.trim();
        if (!seenTargets.has(t)) {
          seenTargets.add(t);
          orderedTargets.push(t);
        }
      }
    }
  }
  const imports: InstructionReference[] = orderedTargets.map((target, index) => ({
    target,
    targetType: /^https?:\/\//.test(target) ? "url" : target.endsWith(".md") ? "file" : "unknown",
    relationship: input.path === "CLAUDE.md" ? "extends" : "imports",
    location: makeLocation(index + 1),
    extractionMethod: target.endsWith(".md") || /^https?:\/\//.test(target) ? "deterministic" : "heuristic"
  }));
  const directives = extractDirectives(body, sections, metadata.owners, scope, lineOffset);
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

  if (directiveops && Object.keys(directiveops).length > 0) {
    validation.push({
      level: "warning",
      source: "parser",
      message: "YAML front matter included a directiveops block; policy rules can align with these hints."
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
    directiveopsMetadata: directiveops,
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
      scope: InstructionScope;
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
        scope: value.scope,
        directiveIds: value.entries.map((entry) => entry.directiveId),
        filePaths: Array.from(new Set(value.entries.map((entry) => entry.filePath)))
      });
    }
  });

  return conflicts;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
