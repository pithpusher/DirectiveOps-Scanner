import type { ExtractionMethod, OwnershipReference, SectionNode, SourceLocation } from "@directiveops/constitution-model";

export interface MarkdownMetadata {
  scope?: string;
  owners: OwnershipReference[];
  imports: string[];
}

export function extractSections(content: string): SectionNode[] {
  const lines = content.split(/\r?\n/);
  const headings = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      if (!match) {
        return null;
      }
      const hashes = match[1];
      const headingText = match[2];
      if (!hashes || !headingText) {
        return null;
      }
      return {
        depth: hashes.length,
        heading: headingText.trim(),
        line: index + 1
      };
    })
    .filter((value): value is { depth: number; heading: string; line: number } => value !== null);

  if (headings.length === 0) {
    return [
      {
        id: "section-root",
        heading: "Document",
        depth: 1,
        content,
        path: ["Document"],
        location: {
          lineStart: 1,
          lineEnd: lines.length
        }
      }
    ];
  }

  return headings.map((heading, index) => {
    const nextHeading = headings[index + 1];
    const lineStart = heading.line;
    const lineEnd = nextHeading ? nextHeading.line - 1 : lines.length;
    const contentLines = lines.slice(lineStart, lineEnd);
    const path = headings
      .slice(0, index + 1)
      .filter((candidate) => candidate.depth <= heading.depth)
      .map((candidate) => candidate.heading);

    return {
      id: `section-${index + 1}`,
      heading: heading.heading,
      depth: heading.depth,
      content: contentLines.join("\n").trim(),
      path,
      location: {
        lineStart,
        lineEnd
      }
    };
  });
}

export function extractMetadata(content: string): MarkdownMetadata {
  const lines = content.split(/\r?\n/);
  const owners: OwnershipReference[] = [];
  const imports = new Set<string>();
  let scope: string | undefined;

  lines.forEach((line) => {
    const scopeMatch = /^Scope:\s*(.+)$/i.exec(line);
    const scopeValue = scopeMatch?.[1];
    if (scopeValue) {
      scope = scopeValue.trim();
    }

    const ownerMatch = /^Owners?:\s*(.+)$/i.exec(line);
    const ownersValue = ownerMatch?.[1];
    if (ownersValue) {
      ownersValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
          owners.push({
            owner: entry,
            kind: entry.startsWith("@") ? "team" : "unknown",
            extractionMethod: "deterministic"
          });
        });
    }

    const importsMatch = /^Imports?:\s*(.+)$/i.exec(line);
    const importsValue = importsMatch?.[1];
    if (importsValue) {
      importsValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => imports.add(entry));
    }

    for (const inlineRef of extractInlineReferences(line)) {
      imports.add(inlineRef);
    }
  });

  return {
    scope,
    owners,
    imports: [...imports]
  };
}

export function extractInlineReferences(line: string): string[] {
  const results = new Set<string>();
  const importContext = /\b(import|extends?|references?|inherits?|includes?)\b/i.test(line);
  const markdownLinks = [...line.matchAll(/\[.+?\]\((.+?)\)/g)];
  markdownLinks.forEach((match) => {
    const target = match[1];
    if (target) {
      results.add(target);
    }
  });

  if (importContext) {
    const backtickRefs = [...line.matchAll(/`([^`]+(?:\.md|\.instructions\.md))`/g)];
    backtickRefs.forEach((match) => {
      const target = match[1];
      if (target) {
        results.add(target);
      }
    });
  }

  const pathLikeRefs = [...line.matchAll(/\b(?:\.\/|\.\.\/|https?:\/\/)[^\s,]+/g)];
  pathLikeRefs.forEach((match) => {
    const target = match[0];
    if (target && (target.startsWith("http") || importContext)) {
      results.add(target);
    }
  });

  const autolinks = [...line.matchAll(/<([^>\s]+)>/g)];
  autolinks.forEach((match) => {
    const target = match[1];
    if (
      target &&
      (target.startsWith("http") ||
        target.endsWith(".md") ||
        target.includes("/") ||
        target.startsWith(".") ||
        target.startsWith("@"))
    ) {
      results.add(target);
    }
  });

  return [...results];
}

export function makeLocation(lineStart: number, lineEnd = lineStart): SourceLocation {
  return {
    lineStart,
    lineEnd
  };
}

export function toExtractionMethod(confidence: number): ExtractionMethod {
  return confidence >= 0.9 ? "deterministic" : "heuristic";
}
