import { ffmpegStatus, makeSilent } from "./ffmpeg";
import type { Store } from "./store";
import fs from "node:fs";

/**
 * One-off cleanup at startup: remove audio from clips downloaded before
 * clips were made silent. Stream copy, so it is lossless and quick. Clips
 * are marked `silent` so they are never probed again.
 */
export async function silenceExisting(store: Store): Promise<number> {
  if (!(await ffmpegStatus()).available) return 0;
  const todo = store
    .get()
    .items.filter(
      (i) =>
        i.kind === "clip" &&
        i.state === "completed" &&
        i.file &&
        i.file.silent !== true &&
        (i.file.format === "mp4" || i.file.format === "mov"),
    );
  let changed = 0;
  for (const it of todo) {
    const p = store.filePath(it);
    if (!p || !fs.existsSync(p)) continue;
    const ok = await makeSilent(p).catch(() => false);
    if (!ok) continue;
    const size = fs.statSync(p).size;
    await store.update((s) => {
      const j = s.items.find((x) => x.id === it.id);
      if (j?.file) {
        j.file.silent = true;
        j.file.bytes = size;
      }
    });
    changed++;
  }
  return changed;
}
