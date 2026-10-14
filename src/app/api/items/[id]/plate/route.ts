import fs from "node:fs";
import path from "node:path";
import { compositeImage, requireFfmpeg } from "@/lib/ffmpeg";
import { inspectImage, newItem } from "@/lib/items";
import { fail, json } from "@/lib/server";
import { plateInstruction } from "@/lib/snapshot";
import { getStore } from "@/lib/store";

/**
 * Create the green-screen version of an image (the first frame for clips).
 * Transparent images get it locally for free; others need one image-model
 * call, which is created as a draft and goes through the normal confirm flow.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getStore();
  const s = store.get();
  const src = s.items.find((i) => i.id === id);
  const project = s.projects.find((p) => p.id === src?.projectId);
  if (!src?.file || !project || src.kind !== "image")
    return fail("Unknown image.", 404);
  if (src.verdict !== "kept") return fail("Keep this image first.", 409);
  const existing = s.items.find((i) => i.id === src.plateId);
  if (existing)
    return fail("This image already has a green-screen version.", 409);

  const name = `${src.name} (green screen)`;
  if (src.file.hasAlpha) {
    try {
      await requireFfmpeg();
      const plate = newItem({
        projectId: src.projectId,
        kind: "image",
        origin: "plate",
        name,
        parentId: src.id,
        verdict: "kept",
        include: false,
        state: "completed",
        completedAt: new Date().toISOString(),
        costUsd: 0,
      });
      const file = `${plate.id}.png`;
      const out = path.join(store.imagesDir, file);
      await compositeImage(
        path.join(store.imagesDir, src.file.file),
        out,
        project.keyColor,
      );
      plate.file = {
        file,
        mediaType: "image/png",
        bytes: fs.statSync(out).size,
        format: "png",
        contentType: null,
        ...inspectImage(new Uint8Array(fs.readFileSync(out))),
      };
      await store.update((st) => {
        plate.order = st.items.reduce((m, j) => Math.max(m, j.order), 0) + 1;
        st.items.push(plate);
        const parent = st.items.find((i) => i.id === src.id);
        if (parent) parent.plateId = plate.id;
      });
      return json({ plate, free: true });
    } catch (e) {
      return fail((e as Error).message, 500);
    }
  }
  const plate = newItem({
    projectId: src.projectId,
    kind: "image",
    origin: "plate",
    name,
    parentId: src.id,
    prompt: plateInstruction(project.keyColor),
  });
  await store.update((st) => {
    plate.order = st.items.reduce((m, j) => Math.max(m, j.order), 0) + 1;
    st.items.push(plate);
  });
  return json({ plate, free: false });
}
