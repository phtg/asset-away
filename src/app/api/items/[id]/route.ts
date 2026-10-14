import fs from "node:fs";
import path from "node:path";
import { ASPECTS } from "@/lib/helpers";
import { fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";
import type { Item } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
const EDITABLE: Item["state"][] = ["draft", "failed"];
const DELETABLE: Item["state"][] = [
  "draft",
  "failed",
  "completed",
  "submission_uncertain",
];
const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!b) return fail("Invalid JSON");
  const store = getStore();
  const result = await store.update((s) => {
    const j = s.items.find((x) => x.id === id);
    if (!j) return "Unknown item";
    if (typeof b.include === "boolean") j.include = b.include;
    // Renaming is cosmetic (files keep their names), so it is always allowed.
    if (typeof b.name === "string" && b.name.trim())
      j.name = b.name.trim().slice(0, 80);
    const touches = Object.keys(b).some(
      (k) => !["include", "name"].includes(k),
    );
    if (!touches) return null;
    if (!EDITABLE.includes(j.state))
      return `Cannot edit an item that is ${j.state}.`;
    if (typeof b.prompt === "string") j.prompt = b.prompt.slice(0, 4000);
    if ("duration" in b) j.duration = int(b.duration);
    if ("seed" in b) j.seed = int(b.seed);
    if ("resolution" in b)
      j.resolution =
        typeof b.resolution === "string" && b.resolution ? b.resolution : null;
    if ("aspectRatio" in b)
      j.aspectRatio = ASPECTS.includes(b.aspectRatio) ? b.aspectRatio : null;
    if (typeof b.loop === "boolean") j.loop = b.loop;
    if ("sourceId" in b && j.kind === "clip") {
      j.sourceId = s.items.some(
        (i) => i.id === b.sourceId && i.kind === "image",
      )
        ? b.sourceId
        : null;
    }
    return null;
  });
  return result ? fail(result, 409) : json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const store = getStore();
  const file = await store.update((s) => {
    const i = s.items.findIndex((x) => x.id === id);
    if (i < 0) return { error: "Unknown item" };
    const it = s.items[i];
    if (!DELETABLE.includes(it.state))
      return { error: `Cannot delete an item that is ${it.state}.` };
    s.items.splice(i, 1);
    for (const p of s.projects) if (p.anchorId === id) p.anchorId = null;
    for (const o of s.items) {
      if (o.plateId === id) o.plateId = null;
      if (o.sourceId === id && o.state === "draft") o.sourceId = null;
    }
    return { file: it.file ? path.join(store.dirFor(it), it.file.file) : null };
  });
  if (file.error) return fail(file.error, 409);
  if (file.file) fs.rmSync(file.file, { force: true });
  return json({ ok: true });
}
