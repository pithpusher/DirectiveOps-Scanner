export interface SplitFrontMatterResult {
  body: string;
  lineOffset: number;
  directiveops?: Record<string, unknown>;
}

export function splitFrontMatter(content: string): SplitFrontMatterResult {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { body: content, lineOffset: 0 };
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      end = index;
      break;
    }
  }

  if (end === -1) {
    return { body: content, lineOffset: 0 };
  }

  const yamlLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n");
  const directiveops = parseDirectiveopsBlock(yamlLines);

  return {
    body,
    lineOffset: end + 1,
    directiveops
  };
}

function parseDirectiveopsBlock(lines: string[]): Record<string, unknown> | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw) {
      continue;
    }

    const trimmed = raw.trim();
    if (trimmed !== "directiveops:") {
      continue;
    }

    const baseIndent = countIndent(raw);
    const parsed = parseObject(lines, index + 1, baseIndent + 2);
    return isPlainObject(parsed.value) ? parsed.value : undefined;
  }

  return undefined;
}

function parseObject(
  lines: string[],
  startIndex: number,
  minIndent: number
): { value: Record<string, unknown>; nextIndex: number } {
  const result: Record<string, unknown> = {};
  let index = startIndex;

  while (index < lines.length) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      index += 1;
      continue;
    }

    const indent = countIndent(raw);
    if (indent < minIndent) {
      break;
    }

    if (indent > minIndent) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      break;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      index += 1;
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const remainder = trimmed.slice(separatorIndex + 1).trim();

    if (remainder) {
      result[key] = parseScalar(remainder);
      index += 1;
      continue;
    }

    const nextIndex = nextMeaningfulLineIndex(lines, index + 1);
    if (nextIndex === -1 || countIndent(lines[nextIndex] ?? "") < minIndent + 2) {
      result[key] = {};
      index += 1;
      continue;
    }

    const nextLine = (lines[nextIndex] ?? "").trim();
    if (nextLine.startsWith("- ")) {
      const parsedArray = parseArray(lines, index + 1, minIndent + 2);
      result[key] = parsedArray.value;
      index = parsedArray.nextIndex;
      continue;
    }

    const parsedObject = parseObject(lines, index + 1, minIndent + 2);
    result[key] = parsedObject.value;
    index = parsedObject.nextIndex;
  }

  return { value: result, nextIndex: index };
}

function parseArray(lines: string[], startIndex: number, minIndent: number): { value: unknown[]; nextIndex: number } {
  const result: unknown[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      index += 1;
      continue;
    }

    const indent = countIndent(raw);
    if (indent < minIndent) {
      break;
    }

    if (indent !== minIndent || !trimmed.startsWith("- ")) {
      index += 1;
      continue;
    }

    const item = trimmed.slice(2).trim();
    if (item) {
      result.push(parseScalar(item));
      index += 1;
      continue;
    }

    const parsedObject = parseObject(lines, index + 1, minIndent + 2);
    result.push(parsedObject.value);
    index = parsedObject.nextIndex;
  }

  return { value: result, nextIndex: index };
}

function nextMeaningfulLineIndex(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return index;
    }
  }
  return -1;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function countIndent(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === " ") {
      count += 1;
      continue;
    }
    if (char === "\t") {
      count += 2;
      continue;
    }
    break;
  }
  return count;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
