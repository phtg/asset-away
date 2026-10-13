import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { buildManifest } from "@/lib/manifest";
import { fail } from "@/lib/server";
import { getStore } from "@/lib/store";

export async function GET() {
  const store = getStore();
  const state = store.get();
  const done = state.jobs.filter(
    (j) =>
      j.state === "completed" &&
      j.output &&
      fs.existsSync(path.join(store.outputsDir, j.output.file)),
  );
  if (!done.length) return fail("No completed videos to download.", 404);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const j of done) {
    // Videos are already compressed: store them without re-compressing.
    files[j.output!.file] = [
      new Uint8Array(
        fs.readFileSync(path.join(store.outputsDir, j.output!.file)),
      ),
      { level: 0 },
    ];
  }
  files["manifest.json"] = new TextEncoder().encode(
    JSON.stringify(buildManifest(state, done), null, 2),
  );
  const zip = zipSync(files);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zip as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="asset-away-${stamp}.zip"`,
    },
  });
}
