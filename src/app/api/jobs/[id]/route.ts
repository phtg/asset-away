import fs from "node:fs";
import path from "node:path";
import { fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";
import type { Job } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
const EDITABLE: Job["state"][] = ["draft", "failed"];
const DELETABLE: Job["state"][] = [
  "draft",
  "failed",
  "completed",
  "awaiting_image_approval",
  "submission_uncertain",
];

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!b) return fail("Invalid JSON");
  const store = getStore();
  const result = await store.update((s) => {
    const j = s.jobs.find((x) => x.id === id);
    if (!j) return "Unknown job";
    if (typeof b.include === "boolean") j.include = b.include;
    const touchesSettings = Object.keys(b).some((k) => k !== "include");
    if (!touchesSettings) return null;
    if (!EDITABLE.includes(j.state))
      return `Cannot edit a job that is ${j.state}.`;

    if (typeof b.name === "string" && b.name.trim())
      j.name = b.name.trim().slice(0, 80);
    if (typeof b.actionPrompt === "string")
      j.actionPrompt = b.actionPrompt.slice(0, 4000);
    if (typeof b.stillPrompt === "string")
      j.stillPrompt = b.stillPrompt.slice(0, 4000);
    if (b.mode === "animate" || b.mode === "prepare") j.mode = b.mode;
    if ("startImageId" in b) {
      j.startImageId =
        typeof b.startImageId === "string" &&
        s.images.some((i) => i.id === b.startImageId)
          ? b.startImageId
          : null;
    }
    if ("duration" in b)
      j.duration = Number.isInteger(b.duration) ? (b.duration as number) : null;
    if ("seed" in b)
      j.seed = Number.isInteger(b.seed) ? (b.seed as number) : null;
    if ("resolution" in b)
      j.resolution =
        typeof b.resolution === "string" && b.resolution ? b.resolution : null;
    if ("aspectRatio" in b)
      j.aspectRatio =
        typeof b.aspectRatio === "string" && b.aspectRatio
          ? b.aspectRatio
          : null;
    return null;
  });
  return result ? fail(result, 409) : json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const store = getStore();
  const files = await store.update((s) => {
    const i = s.jobs.findIndex((x) => x.id === id);
    if (i < 0) return "Unknown job" as const;
    if (!DELETABLE.includes(s.jobs[i].state))
      return `Cannot delete a job that is ${s.jobs[i].state}.` as const;
    const [j] = s.jobs.splice(i, 1);
    return { still: j.still?.file, out: j.output?.file };
  });
  if (typeof files === "string") return fail(files, 409);
  if (files.still)
    fs.rmSync(path.join(store.stillsDir, files.still), { force: true });
  if (files.out)
    fs.rmSync(path.join(store.outputsDir, files.out), { force: true });
  return json({ ok: true });
}
