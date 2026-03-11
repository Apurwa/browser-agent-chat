/**
 * Extract JSON blocks from text following a prefix like "MEMORY_JSON:" or "FINDING_JSON:".
 * Uses brace-counting instead of regex to handle nested objects, arrays, and escaped strings.
 */
export function extractJsonBlocks(text: string, prefix: string): string[] {
  const results: string[] = [];
  let idx = text.indexOf(prefix);

  while (idx !== -1) {
    const start = idx + prefix.length;
    if (start >= text.length || text[start] !== '{') {
      idx = text.indexOf(prefix, start);
      continue;
    }

    let depth = 0;
    let inStr = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (depth === 0) {
        results.push(text.slice(start, i + 1));
        break;
      }
    }

    idx = text.indexOf(prefix, start + 1);
  }

  return results;
}
