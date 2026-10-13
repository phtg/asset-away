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

// ---- JSON import/export of the job list ----

export interface ExportedJob {
  name: string;
  include: boolean;
  mode: "animate" | "prepare";
  startImageName: string | null;
  actionPrompt: string;
  stillPrompt: string;
  duration: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  seed: number | null;
}

export interface ExportedJobList {
  format: "asset-away-jobs";
  version: 1;
  sharedInstructions?: string;
  jobs: ExportedJob[];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function nullableInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** Validates untrusted JSON; throws a readable Error when it is unusable. */
export function parseJobListJson(raw: string): ExportedJobList {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const obj = data as Record<string, unknown>;
  const list = Array.isArray(data) ? data : obj?.jobs;
  if (!Array.isArray(list)) {
    throw new Error('Expected a JSON object with a "jobs" array.');
  }
  const jobs: ExportedJob[] = list.map((j, i) => {
    const r = (j ?? {}) as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name) throw new Error(`Job ${i + 1} has no name.`);
    return {
      name,
      include: r.include !== false,
      mode: r.mode === "prepare" ? "prepare" : "animate",
      startImageName: nullableStr(r.startImageName),
      actionPrompt: str(r.actionPrompt),
      stillPrompt: str(r.stillPrompt),
      duration: nullableInt(r.duration),
      resolution: nullableStr(r.resolution),
      aspectRatio: nullableStr(r.aspectRatio),
      seed: nullableInt(r.seed),
    };
  });
  return {
    format: "asset-away-jobs",
    version: 1,
    sharedInstructions:
      !Array.isArray(data) && typeof obj.sharedInstructions === "string"
        ? obj.sharedInstructions
        : undefined,
    jobs,
  };
}
