export interface ParsedBlock {
  name: string;
  actionPrompt: string;
}

export interface ParseResult {
  blocks: ParsedBlock[];
  warnings: string[];
}

/**
 * Blocks are separated by a line containing only `---`.
 * First non-empty line of a block = animation name; the rest = motion prompt.
 */
export function parseBulkPrompts(text: string): ParseResult {
  const blocks: ParsedBlock[] = [];
  const warnings: string[] = [];
  const chunks = text.replace(/\r\n?/g, "\n").split(/^[ \t]*---[ \t]*$/m);

  chunks.forEach((chunk, i) => {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    const [name, ...rest] = lines;
    const actionPrompt = rest.join(" ");
    if (!actionPrompt) {
      warnings.push(`Block ${i + 1} ("${name}") has no motion prompt.`);
    }
    blocks.push({ name, actionPrompt });
  });

  return { blocks, warnings };
}

export function composePrompt(shared: string, action: string): string {
  return [action.trim(), shared.trim()].filter(Boolean).join("\n\n");
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return s || "animation";
}

/**
 * Models sometimes wrap answers in <prompt>…</prompt>, <notes>, or code
 * fences even when told not to. Strip a wrapper so the suggestion is plain.
 */
export function cleanHelperText(text: string): string {
  let t = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1].trim();
  const tag =
    /^<(prompt|notes|answer|output|response)>\s*([\s\S]*?)\s*<\/\1>$/i.exec(t);
  if (tag) t = tag[2].trim();
  t = t
    .replace(
      /^<\/?(prompt|notes|answer|output|response)>\s*|\s*<\/?(prompt|notes|answer|output|response)>$/gi,
      "",
    )
    .trim();
  return t;
}
