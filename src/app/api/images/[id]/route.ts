import fs from "node:fs";
import path from "node:path";
import { fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    identityRef?: boolean;
  } | null;
  if (!body) return fail("Invalid JSON");
  const store = getStore();
  const ok = await store.update((s) => {
    const img = s.images.find((i) => i.id === id);
    if (!img) return false;
    if (typeof body.name === "string" && body.name.trim())
      img.name = body.name.trim().slice(0, 80);
    if (typeof body.identityRef === "boolean")
      img.identityRef = body.identityRef;
    return true;
  });
  return ok ? json({ ok: true }) : fail("Unknown image", 404);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const store = getStore();
  const file = await store.update((s) => {
    const i = s.images.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [img] = s.images.splice(i, 1);
    if (s.settings.defaultImageId === id)
      s.settings.defaultImageId = s.images[0]?.id ?? null;
    for (const j of s.jobs)
      if (j.startImageId === id && j.state === "draft") j.startImageId = null;
    return img.file;
  });
  if (!file) return fail("Unknown image", 404);
  fs.rmSync(path.join(store.imagesDir, file), { force: true });
  return json({ ok: true });
}
