export type MarkdownMarkerToken = {
  kind: "marker";
  start: number;
  end: number;
  text: string;
  targetId: string;
  label: string;
};

export type MarkdownLinkToken = {
  kind: "link";
  start: number;
  end: number;
  text: string;
  destination: string;
};

export type MarkdownProtectedToken = {
  kind: "protected";
  start: number;
  end: number;
  text: string;
  reason: "frontmatter" | "fence" | "inline-code" | "quote" | "uri";
};

export type MarkdownToken = MarkdownMarkerToken | MarkdownLinkToken | MarkdownProtectedToken;

function runAt(text: string, start: number, character: string): number {
  let length = 0;
  while (text[start + length] === character) length += 1;
  return length;
}

function lineEnd(text: string, start: number): number {
  const end = text.indexOf("\n", start);
  return end === -1 ? text.length : end + 1;
}

function isLineStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === "\n";
}

function lineFence(text: string, index: number): { character: "`" | "~"; length: number; end: number } | undefined {
  if (!isLineStart(text, index)) return undefined;
  let cursor = index;
  let spaces = 0;
  while (spaces < 3 && text[cursor] === " ") {
    cursor += 1;
    spaces += 1;
  }
  const character = text[cursor] === "`" || text[cursor] === "~" ? text[cursor] as "`" | "~" : undefined;
  if (!character) return undefined;
  const length = runAt(text, cursor, character);
  return length >= 3 ? { character, length, end: lineEnd(text, index) } : undefined;
}

function quoteLineContentStart(text: string, index: number): number | undefined {
  if (!isLineStart(text, index)) return undefined;
  let cursor = index;
  let spaces = 0;
  while (spaces < 3 && text[cursor] === " ") {
    cursor += 1;
    spaces += 1;
  }
  return text[cursor] === ">" ? cursor + 1 : undefined;
}

function lineIsQuote(text: string, index: number): boolean {
  return quoteLineContentStart(text, index) !== undefined;
}

function lineCanBeLazyQuoteContinuation(text: string, index: number): boolean {
  if (!isLineStart(text, index) || lineIsQuote(text, index) || lineFence(text, index)) return false;
  const end = lineEnd(text, index);
  const line = text.slice(index, end).replace(/\r?\n$/, "");
  if (!line.trim()) return false;
  // These block starts terminate the quoted paragraph instead of being lazy
  // continuation text. Plain lines—including authored markers—can continue
  // the paragraph and therefore remain inside the quote container.
  if (/^ {0,3}(?:#{1,6}(?:\s|$)|[-+*](?:\s|$)|\d+[.)](?:\s|$)|(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})/.test(line)) return false;
  return true;
}

function matchingBracket(text: string, start: number, open: string, close: string): number | undefined {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === open) depth += 1;
    else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
    if (text[index] === "\n" && depth === 0) return undefined;
  }
  return undefined;
}

/** Find an inline Markdown link, including balanced destinations and optional titles. */
function markdownLinkEnd(text: string, start: number): { end: number; destination: string } | undefined {
  const labelEnd = matchingBracket(text, start, "[", "]");
  if (labelEnd === undefined) return undefined;
  let cursor = labelEnd + 1;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
  if (text[cursor] === "[") {
    const referenceEnd = matchingBracket(text, cursor, "[", "]");
    return referenceEnd === undefined ? undefined : { end: referenceEnd + 1, destination: "" };
  }
  if (text[cursor] !== "(") return undefined;
  cursor += 1;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;

  let destination = "";
  if (text[cursor] === "<") {
    const destinationStart = ++cursor;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === "\\") {
        cursor += 1;
        continue;
      }
      if (text[cursor] === "\n") return undefined;
      if (text[cursor] === ">") break;
    }
    if (cursor >= text.length) return undefined;
    destination = text.slice(destinationStart, cursor);
    cursor += 1;
  } else {
    const destinationStart = cursor;
    let depth = 0;
    for (; cursor < text.length; cursor += 1) {
      const character = text[cursor]!;
      if (character === "\\") {
        cursor += 1;
        continue;
      }
      if (character === "\n") return undefined;
      if (character === "(") {
        depth += 1;
        continue;
      }
      if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if ((character === " " || character === "\t") && depth === 0) break;
    }
    if (depth !== 0) return undefined;
    destination = text.slice(destinationStart, cursor);
  }

  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
  if (text[cursor] === ")") return { end: cursor + 1, destination };
  const titleDelimiter = text[cursor];
  if (titleDelimiter !== '"' && titleDelimiter !== "'" && titleDelimiter !== "(") return undefined;
  const titleEnd = titleDelimiter === "(" ? ")" : titleDelimiter;
  let titleDepth = titleDelimiter === "(" ? 1 : 0;
  cursor += 1;
  for (; cursor < text.length; cursor += 1) {
    const character = text[cursor]!;
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === "\n") return undefined;
    if (titleDelimiter === "(" && character === "(") {
      titleDepth += 1;
      continue;
    }
    if (character === titleEnd) {
      if (titleDelimiter === "(" && --titleDepth > 0) continue;
      cursor += 1;
      while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
      return text[cursor] === ")" ? { end: cursor + 1, destination } : undefined;
    }
  }
  return undefined;
}

function inlineCodeEnd(text: string, start: number): number | undefined {
  const length = runAt(text, start, "`");
  for (let index = start + length; index < text.length; index += 1) {
    if (text[index] !== "`") continue;
    const closingLength = runAt(text, index, "`");
    if (closingLength === length) return index + length;
    index += closingLength - 1;
  }
  return undefined;
}

function bareUriEnd(text: string, start: number): number | undefined {
  if (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) return undefined;
  const match = text.slice(start).match(/^[A-Za-z][A-Za-z0-9+.-]*:/);
  if (!match) return undefined;
  let end = start;
  while (end < text.length && !/\s/.test(text[end]!)) end += 1;
  return end;
}

function markerToken(text: string, start: number): MarkdownMarkerToken | undefined {
  const end = text.indexOf("]]", start + 2);
  if (end === -1) return undefined;
  const marker = text.slice(start + 2, end);
  const separator = marker.indexOf("|");
  const targetId = (separator === -1 ? marker : marker.slice(0, separator)).trim();
  const label = (separator === -1 ? targetId : marker.slice(separator + 1)).trim();
  if (!targetId || !label || /[\r\n]/.test(marker)) return undefined;
  return { kind: "marker", start, end: end + 2, text: text.slice(start, end + 2), targetId, label };
}

/**
 * Tokenize authored Markdown markers while treating Markdown syntax and literal
 * regions as opaque. The same tokenizer is used by emission and lint so a
 * marker in code, a quote, a URI, or an existing link has one interpretation.
 */
export function scanMarkdownMarkers(text: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = [];
  let index = 0;
  let fence: { character: "`" | "~"; length: number } | undefined;
  let lazyQuoteContinuation = false;
  let frontmatterEnd = -1;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    if (end !== -1) frontmatterEnd = end + "\n---\n".length;
  }
  if (frontmatterEnd > 0) {
    tokens.push({ kind: "protected", start: 0, end: frontmatterEnd, text: text.slice(0, frontmatterEnd), reason: "frontmatter" });
    index = frontmatterEnd;
  }
  while (index < text.length) {
    if (isLineStart(text, index)) {
      const quoteContentStart = quoteLineContentStart(text, index);
      if (quoteContentStart !== undefined) {
        const end = lineEnd(text, index);
        tokens.push({ kind: "protected", start: index, end, text: text.slice(index, end), reason: "quote" });
        lazyQuoteContinuation = Boolean(text.slice(quoteContentStart, end).replace(/\r?\n$/, "").trim());
        index = end;
        continue;
      }
      if (lazyQuoteContinuation) {
        const end = lineEnd(text, index);
        if (lineCanBeLazyQuoteContinuation(text, index)) {
          tokens.push({ kind: "protected", start: index, end, text: text.slice(index, end), reason: "quote" });
          index = end;
          continue;
        }
        lazyQuoteContinuation = false;
      }
    }
    const lineFenceMatch = lineFence(text, index);
    if (lineFenceMatch) {
      const isClosing = Boolean(fence && lineFenceMatch.character === fence.character && lineFenceMatch.length >= fence.length);
      if (!fence || isClosing) {
        const end = lineFenceMatch.end;
        tokens.push({ kind: "protected", start: index, end, text: text.slice(index, end), reason: "fence" });
        if (isClosing) fence = undefined;
        else fence = { character: lineFenceMatch.character, length: lineFenceMatch.length };
        index = end;
        continue;
      }
    }
    if (fence) {
      const end = lineEnd(text, index);
      tokens.push({ kind: "protected", start: index, end, text: text.slice(index, end), reason: "fence" });
      index = end;
      continue;
    }
    if (lineIsQuote(text, index)) {
      const end = lineEnd(text, index);
      tokens.push({ kind: "protected", start: index, end, text: text.slice(index, end), reason: "quote" });
      index = end;
      continue;
    }
    if (text[index] === "`") {
      const end = inlineCodeEnd(text, index);
      if (end !== undefined) {
        tokens.push({ kind: "protected", start: index, end, text: text.slice(index, end), reason: "inline-code" });
        index = end;
        continue;
      }
    }
    if (text[index] === "[") {
      const link = markdownLinkEnd(text, index);
      if (link) {
        tokens.push({ kind: "link", start: index, end: link.end, text: text.slice(index, link.end), destination: link.destination });
        index = link.end;
        continue;
      }
    }
    const uriEnd = bareUriEnd(text, index);
    if (uriEnd !== undefined) {
      tokens.push({ kind: "protected", start: index, end: uriEnd, text: text.slice(index, uriEnd), reason: "uri" });
      index = uriEnd;
      continue;
    }
    if (text.startsWith("[[", index)) {
      const marker = markerToken(text, index);
      if (marker) {
        tokens.push(marker);
        index = marker.end;
        continue;
      }
    }
    index += 1;
  }
  return tokens;
}

export function authoredMarkdownMarkers(text: string): MarkdownMarkerToken[] {
  return scanMarkdownMarkers(text).filter((token): token is MarkdownMarkerToken => token.kind === "marker");
}

export function authoredMarkdownLinks(text: string): MarkdownLinkToken[] {
  return scanMarkdownMarkers(text).filter((token): token is MarkdownLinkToken => token.kind === "link");
}
