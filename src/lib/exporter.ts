import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  compositeImage,
  pingPong,
  requireFfmpeg,
  sampleCorner,
  videoToGif,
  videoToMp4OnColor,
  videoToWebmAlpha,
} from "./ffmpeg";
import { normalizeHex } from "./items";
import { slugify } from "./parse";
import type { Store } from "./store";
import type { Item } from "./types";

export type ExportFormat = "original" | "png" | "mp4" | "gif" | "webm";

export interface ExportOptions {
  background: { mode: "transparent" | "color"; color: string };
  /** Chroma-key tolerance, 0.05 (strict) .. 0.4 (generous). */
  similarity: number;
  /** Add a reversed copy so a non-looping clip loops. */
  pingPong: boolean;
  /** Drop the first N frames of clips (models often re-render them). */
  trimFrames?: number;
}

export type Rendered =
  | { ok: true; path: string; name: string; format: string }
  | { ok: false; reason: string };

/** A clip made on a key colour can be keyed; imported/other clips cannot. */
export function isKeyable(item: Item): boolean {
  return item.kind === "clip" && item.run?.startFrame === "plate";
}

const ext = (name: string) => path.extname(name).slice(1);
const base = (name: string) =>
  name.slice(0, name.length - ext(name).length - 1);

function bgLabel(o: ExportOptions): string {
  return o.background.mode === "color"
    ? o.background.color.replace("#", "")
    : "transparent";
}

/**
 * Render one item in one format. Results are cached under data/exports so
 * previews and repeated downloads are instant.
 */
export async function renderItem(
  store: Store,
  item: Item,
  format: ExportFormat,
  o: ExportOptions,
): Promise<Rendered> {
  const src = store.filePath(item);
  if (!item.file || !src || !fs.existsSync(src))
    return { ok: false, reason: "file missing" };
  // readable names: images use their title, clips keep source-animation-NN
  const stem =
    item.kind === "image" ? slugify(item.name) : base(item.file.file);
  if (format === "original") {
    return {
      ok: true,
      path: src,
      name: item.file.file,
      format: item.file.format,
    };
  }
  const color =
    o.background.mode === "color" ? normalizeHex(o.background.color) : null;
  if (o.background.mode === "color" && !color)
    return { ok: false, reason: "invalid colour" };
  const key = crypto
    .createHash("sha1")
    .update(
      [
        item.id,
        item.file.file,
        format,
        bgLabel(o),
        o.similarity,
        o.pingPong,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);
  const cached = (e: string) => path.join(store.exportsDir, `${key}.${e}`);
  const out = (e: string): Rendered => ({
    ok: true,
    path: cached(e),
    name: `${stem}-${bgLabel(o)}${o.pingPong && item.kind === "clip" ? "-loop" : ""}.${e}`,
    format: e,
  });

  // ----- images -----
  if (item.kind === "image") {
    if (format !== "png")
      return { ok: false, reason: `${format.toUpperCase()} is for clips` };
    if (!color) {
      if (!item.file.hasAlpha)
        return { ok: false, reason: "this image has no transparency" };
      return {
        ok: true,
        path: src,
        name: `${stem}-transparent.${ext(item.file.file)}`,
        format: "png",
      };
    }
    if (!fs.existsSync(cached("png"))) {
      await requireFfmpeg();
      await compositeImage(src, cached("png"), color);
    }
    return out("png");
  }

  // ----- clips -----
  if (format === "png") return { ok: false, reason: "PNG is for images" };
  if (!isKeyable(item)) {
    return {
      ok: false,
      reason:
        "this clip was not made on a green screen, so its background can't be changed",
    };
  }
  if (format === "mp4" && !color) {
    return {
      ok: false,
      reason: "MP4 can't be transparent: pick a colour, or use GIF/WebM",
    };
  }
  const e = format;
  if (!fs.existsSync(cached(e))) {
    await requireFfmpeg();
    const keyColor = await sampleCorner(src).catch(
      () => item.run?.keyColor ?? "#00ff00",
    );
    let input = src;
    const tmp = cached("pp.mp4");
    if (o.pingPong) {
      await pingPong(src, tmp);
      input = tmp;
    }
    const k = {
      keyColor,
      similarity: o.similarity,
      background: color,
      loop: o.pingPong || item.loop,
    };
    try {
      if (format === "mp4")
        await videoToMp4OnColor(input, cached(e), { ...k, background: color! });
      else if (format === "gif") await videoToGif(input, cached(e), k);
      else await videoToWebmAlpha(input, cached(e), k);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  // WebM keeps alpha only when no background colour is chosen
  if (format === "webm" && color) {
    return {
      ok: false,
      reason:
        "WebM is only useful transparent; use MP4 for a coloured background",
    };
  }
  return out(e);
}
