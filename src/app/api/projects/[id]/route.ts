import fs from "node:fs";
import path from "node:path";
import { normalizeHex } from "@/lib/items";
import { fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!b) return fail("Invalid JSON");
  const store = getStore();
  const err = await store.update((s) => {
    const p = s.projects.find((x) => x.id === id);
    if (!p) return "Unknown project";
    if (typeof b.name === "string" && b.name.trim())
      p.name = b.name.trim().slice(0, 60);
    if (["mascot", "icon", "illustration", "other"].includes(b.kind))
      p.kind = b.kind;
    if (typeof b.brief === "string") p.brief = b.brief.slice(0, 2000);
    if (typeof b.styleRules === "string")
      p.styleRules = b.styleRules.slice(0, 3000);
    if (typeof b.animationRules === "string")
      p.animationRules = b.animationRules.slice(0, 3000);
    if (typeof b.cutout === "boolean") p.cutout = b.cutout;
    if (typeof b.greenScreen === "boolean") p.greenScreen = b.greenScreen;
    if (typeof b.keyColor === "string") {
      const c = normalizeHex(b.keyColor);
      if (c) p.keyColor = c;
    }
    if (b.background && typeof b.background === "object") {
      const c =
        typeof b.background.color === "string"
          ? normalizeHex(b.background.color)
          : null;
      if (b.background.mode === "transparent" || b.background.mode === "color")
        p.background.mode = b.background.mode;
      if (c) p.background.color = c;
    }
    if ("anchorId" in b) {
      p.anchorId =
        typeof b.anchorId === "string" &&
        s.items.some(
          (i) =>
            i.id === b.anchorId && i.projectId === id && i.kind === "image",
        )
          ? b.anchorId
          : null;
    }
    return null;
  });
  return err ? fail(err, 404) : json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const store = getStore();
  const files = await store.update((s) => {
    if (s.projects.length <= 1) return "Keep at least one project." as const;
    const doomed = s.items.filter((i) => i.projectId === id);
    if (
      doomed.some((i) =>
        ["queued", "submitting", "generating", "downloading"].includes(i.state),
      )
    ) {
      return "Wait for running items to finish first." as const;
    }
    s.projects = s.projects.filter((p) => p.id !== id);
    s.batches = s.batches.filter((b) => b.projectId !== id);
    s.items = s.items.filter((i) => i.projectId !== id);
    if (s.settings.activeProjectId === id)
      s.settings.activeProjectId = s.projects[0].id;
    return doomed.flatMap((i) =>
      i.file ? [path.join(store.dirFor(i), i.file.file)] : [],
    );
  });
  if (typeof files === "string") return fail(files, 409);
  for (const f of files) fs.rmSync(f, { force: true });
  return json({ ok: true });
}
