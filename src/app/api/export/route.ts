import fs from "node:fs";
import { zipSync } from "fflate";
import {
  renderItem,
  type ExportFormat,
  type ExportOptions,
} from "@/lib/exporter";
import { normalizeHex } from "@/lib/items";
import { buildManifest } from "@/lib/manifest";
import { fail } from "@/lib/server";
import { getStore } from "@/lib/store";

const FORMATS: ExportFormat[] = ["original", "png", "mp4", "gif", "webm"];

/** Render the chosen items/formats on the chosen background into a ZIP. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    itemIds?: string[];
    formats?: ExportFormat[];
    background?: { mode?: string; color?: string };
    similarity?: number;
    pingPong?: boolean;
    trimFrames?: number;
  } | null;
  if (!b?.itemIds?.length) return fail("Select something to export.");
  const formats = (b.formats ?? []).filter((f) => FORMATS.includes(f));
  if (!formats.length) return fail("Choose at least one format.");
  const mode = b.background?.mode === "color" ? "color" : "transparent";
  const color = normalizeHex(b.background?.color ?? "") ?? "#ffffff";
  const opts: ExportOptions = {
    background: { mode, color },
    similarity: Math.min(0.4, Math.max(0.05, Number(b.similarity) || 0.15)),
    pingPong: b.pingPong === true,
    trimFrames: Math.min(
      24,
      Math.max(0, Math.round(Number(b.trimFrames) || 0)),
    ),
  };
  const store = getStore();
  const items = b.itemIds
    .flatMap((id) => store.item(id) ?? [])
    .filter((i) => i.state === "completed" && i.file);

  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const results: {
    item: string;
    format: string;
    file: string | null;
    skipped?: string;
  }[] = [];
  try {
    for (const it of items) {
      for (const f of formats) {
        // each format only applies to one kind; silently skip the other
        if (
          (f === "png" && it.kind !== "image") ||
          (["mp4", "gif", "webm"].includes(f) && it.kind !== "clip")
        )
          continue;
        const r = await renderItem(store, it, f, opts);
        if (!r.ok) {
          results.push({
            item: it.name,
            format: f,
            file: null,
            skipped: r.reason,
          });
          continue;
        }
        let name = r.name;
        for (let n = 2; used.has(name); n++)
          name = r.name.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`);
        used.add(name);
        files[name] = new Uint8Array(fs.readFileSync(r.path));
        results.push({ item: it.name, format: f, file: name });
      }
    }
  } catch (e) {
    return fail((e as Error).message, 500);
  }
  if (!Object.keys(files).length) {
    return fail(
      `Nothing could be exported: ${results.map((r) => `${r.item}: ${r.skipped}`).join("; ")}`,
      422,
    );
  }
  files["manifest.json"] = new TextEncoder().encode(
    JSON.stringify(buildManifest(store.get(), items, opts, results), null, 2),
  );
  // Media is already compressed; store without re-compressing.
  const entries = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [
      k,
      k.endsWith(".json")
        ? v
        : ([v, { level: 0 }] as [Uint8Array, { level: 0 }]),
    ]),
  );
  const zip = zipSync(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zip as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="asset-away-${stamp}.zip"`,
    },
  });
}
