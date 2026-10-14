import { newItem } from "@/lib/items";
import { fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";

/** Reject this result and create a fresh draft with the same prompt. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getStore();
  const created = await store.update((s) => {
    const old = s.items.find((x) => x.id === id);
    if (!old || old.state !== "completed" || old.origin === "upload")
      return null;
    old.verdict = "rejected";
    if (old.origin === "plate" && old.parentId) {
      const parent = s.items.find((x) => x.id === old.parentId);
      if (parent?.plateId === old.id) parent.plateId = null;
    }
    const n = newItem({
      projectId: old.projectId,
      kind: old.kind,
      origin: old.origin,
      name: old.name,
      prompt: old.prompt,
      batchId: old.batchId,
      parentId: old.origin === "plate" ? old.parentId : old.id,
      sourceId: old.sourceId,
      duration: old.duration,
      resolution: old.resolution,
      aspectRatio: old.aspectRatio,
      seed: null,
      loop: old.loop,
      suggestion: old.suggestion,
      order: s.items.reduce((m, j) => Math.max(m, j.order), 0) + 1,
    });
    s.items.push(n);
    return n;
  });
  return created
    ? json({ item: created })
    : fail("Only generated results can be regenerated.", 409);
}
