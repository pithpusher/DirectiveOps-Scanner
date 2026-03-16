export type InstructionFileType = "AGENTS_MD" | "CLAUDE_MD" | "GEMINI_MD" | "COPILOT_INSTRUCTIONS" | "GITHUB_INSTRUCTIONS" | "PROMPT_FILE" | "UNKNOWN";
export type InstructionScope = "organization" | "repository" | "directory" | "file" | "workflow" | "tool" | "unknown";
export type DirectiveCategory = "testing" | "style" | "security" | "workflow" | "documentation" | "repo-conventions" | "release" | "ownership" | "quality" | "unknown";
export type DirectiveStrength = "must" | "should" | "may" | "avoid" | "unknown";
export type ConstitutionStatus = "draft" | "active" | "superseded" | "archived";
export type ValidationStatus = "valid" | "warning" | "invalid" | "unresolved";
export type ExtractionMethod = "deterministic" | "heuristic";
export type ParserKind = "agents-markdown" | "claude-markdown" | "gemini-markdown" | "copilot-markdown" | "generic-markdown";
export interface SourceLocation {
    lineStart: number;
    lineEnd: number;
}
export interface SectionNode {
    id: string;
    heading: string;
    depth: number;
    content: string;
    path: string[];
    location: SourceLocation;
}
export interface InstructionReference {
    target: string;
    targetType: "file" | "url" | "unknown";
    relationship: "imports" | "extends" | "references";
    location: SourceLocation;
    extractionMethod: ExtractionMethod;
    existsInRepository?: boolean;
}
export interface OwnershipReference {
    owner: string;
    kind: "team" | "user" | "unknown";
    extractionMethod: ExtractionMethod;
}
export interface ValidationMessage {
    level: ValidationStatus;
    message: string;
    source: "parser" | "policy";
}
export interface NormalizedDirective {
    id: string;
    key: string;
    rawText: string;
    normalizedText: string;
    category: DirectiveCategory;
    strength: DirectiveStrength;
    scope: InstructionScope;
    tags: string[];
    owners: OwnershipReference[];
    appliesTo: string[];
    extractionMethod: ExtractionMethod;
    confidence: number;
    location: SourceLocation;
    sourceSectionId?: string;
    metadata?: Record<string, string | number | boolean | string[]>;
}
export interface NormalizedInstructionFile {
    id: string;
    repositoryId: string;
    path: string;
    fileType: InstructionFileType;
    parserKind: ParserKind;
    scope: InstructionScope;
    precedence: number;
    rawContent: string;
    sections: SectionNode[];
    imports: InstructionReference[];
    directives: NormalizedDirective[];
    tags: string[];
    owners: OwnershipReference[];
    validation: ValidationMessage[];
    parserConfidence: number;
    status: ConstitutionStatus;
}
export interface ConstitutionLayer {
    id: string;
    repositoryId: string;
    organizationId: string;
    scope: InstructionScope;
    precedence: number;
    sourceFileIds: string[];
    inheritedLayerIds: string[];
    imports: InstructionReference[];
    directives: NormalizedDirective[];
    tags: string[];
    owners: OwnershipReference[];
    validation: ValidationMessage[];
    status: ConstitutionStatus;
}
export interface ConstitutionGraph {
    constitutionId: string;
    repositoryId: string;
    organizationId: string;
    versionLabel: string;
    layers: ConstitutionLayer[];
    sourceFiles: NormalizedInstructionFile[];
    validation: ValidationMessage[];
    createdAt: string;
}
export interface DirectiveConflict {
    key: string;
    category: DirectiveCategory;
    scope: InstructionScope;
    directiveIds: string[];
    filePaths: string[];
}
export interface ConstitutionDiffPreview {
    repositoryId: string;
    repositoryName: string;
    currentVersionLabel: string;
    targetVersionLabel: string;
    filesToTouch: Array<{
        path: string;
        action: "create" | "update" | "delete";
        summary: string;
    }>;
    findingDelta: {
        resolved: number;
        introduced: number;
        unchanged: number;
    };
}
export declare const FILE_PRECEDENCE: Record<InstructionFileType, number>;
export declare function inferPrecedence(fileType: InstructionFileType, path: string): number;
export declare function summarizeDirectiveKey(category: DirectiveCategory, normalizedText: string): string;
export declare function sortLayersByPrecedence(layers: ConstitutionLayer[]): ConstitutionLayer[];
