import fs from "node:fs";
import path from "node:path";
import { data, parseAnimations, parsePoses, SYSTEM } from "@/lib/helpers";
import { cleanHelperText } from "@/lib/parse";
import { redact } from "@/lib/redact";
import { currentProvider, fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";

/** Explicit, user-triggered, paid helper calls. Never run automatically. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    kind?: "poses" | "animations" | "refine";
    projectId?: string;
    itemId?: string;
    count?: number;
    theme?: string;
  } | null;
  if (!b?.kind || !(b.kind in SYSTEM)) return fail("Unknown helper.");
  const store = getStore();
  const s = store.get();
  const model = s.settings.helperModel;
  if (!model) return fail("Choose a helper model first (Settings).");
  const item = b.itemId ? store.item(b.itemId) : undefined;
  const project = s.projects.find(
    (p) => p.id === (b.projectId ?? item?.projectId),
  );
  if (!project) return fail("Unknown project.");
  const n = Math.min(12, Math.max(1, Math.round(b.count ?? 4)));

  const images: { mediaType: string; bytes: Uint8Array }[] = [];
  const attach = (id: string | null | undefined) => {
    const it = s.items.find((i) => i.id === id);
    const p = it && store.filePath(it);
    if (it?.file && p && fs.existsSync(p) && it.kind === "image") {
      images.push({
        mediaType: it.file.mediaType,
        bytes: new Uint8Array(fs.readFileSync(p)),
      });
      return true;
    }
    return false;
  };

  let user: string;
  if (b.kind === "refine") {
    if (!item?.prompt.trim()) return fail("The prompt is empty.");
    user = `Rewrite this motion prompt.\n${data(item.prompt)}`;
  } else if (b.kind === "poses") {
    if (!attach(project.anchorId))
      return fail("Set a style anchor image first (Style tab).");
    user = `Plan ${n} different images for this ${project.kind} set.\n${data(
      `Style brief: ${project.brief || "(none)"}\nExtra direction: ${(b.theme ?? "").slice(0, 500) || "(none)"}`,
    )}`;
  } else {
    if (!attach(item?.id)) return fail("Choose a source image first.");
    user = `Plan ${n} different animations for the subject in the image.\n${data(
      `Name: ${item!.name}\nStyle brief: ${project.brief || "(none)"}\nExtra direction: ${(b.theme ?? "").slice(0, 500) || "(none)"}`,
    )}`;
  }

  try {
    // Paid call: never retried automatically.
    const raw = await currentProvider().chat({
      model,
      system: SYSTEM[b.kind],
      user,
      images,
    });
    if (b.kind === "refine") return json({ text: cleanHelperText(raw) });
    const ideas = b.kind === "poses" ? parsePoses(raw) : parseAnimations(raw);
    if (!ideas.length)
      return fail(
        "The helper's answer could not be understood. Try again.",
        502,
      );
    return json({ ideas: ideas.slice(0, n) });
  } catch (e) {
    return fail(redact(`Helper failed: ${(e as Error).message}`), 502);
  }
}
