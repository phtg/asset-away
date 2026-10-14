import { newItem } from "@/lib/items";
import { fail, json, newId } from "@/lib/server";
import { getStore } from "@/lib/store";
import { ASPECTS } from "@/lib/helpers";
import type { Item } from "@/lib/types";

const MAX = 500;
const s = (v: unknown, max: number) =>
  typeof v === "string" ? v.slice(0, max) : "";
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) ? v : null;

/** Create draft cards (images or clips) in a new batch. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    projectId?: string;
    kind?: "image" | "clip";
    label?: string;
    items?: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  } | null;
  if (
    !b ||
    !Array.isArray(b.items) ||
    (b.kind !== "image" && b.kind !== "clip")
  ) {
    return fail("Expected {projectId, kind, items: [...]}");
  }
  const store = getStore();
  const kind = b.kind;
  const batchId = newId();
  const created: Item[] = [];
  const err = await store.update((st) => {
    if (!st.projects.some((p) => p.id === b.projectId))
      return "Unknown project.";
    let order = st.items.reduce((m, j) => Math.max(m, j.order), 0);
    for (const raw of b.items!) {
      if (st.items.length + created.length >= MAX) break;
      const name = s(raw.name, 80).trim();
      if (!name) continue;
      const sourceId =
        kind === "clip" &&
        st.items.some((i) => i.id === raw.sourceId && i.kind === "image")
          ? raw.sourceId
          : null;
      const sug = raw.suggestion;
      created.push(
        newItem({
          projectId: b.projectId!,
          kind,
          name,
          prompt: s(raw.prompt, 4000),
          order: ++order,
          batchId,
          sourceId,
          duration: int(raw.duration),
          resolution:
            typeof raw.resolution === "string" && raw.resolution
              ? raw.resolution
              : null,
          aspectRatio: ASPECTS.includes(raw.aspectRatio)
            ? raw.aspectRatio
            : null,
          seed: int(raw.seed),
          loop: raw.loop === true,
          suggestion:
            sug && typeof sug === "object"
              ? {
                  duration: int(sug.duration),
                  aspectRatio: ASPECTS.includes(sug.aspectRatio)
                    ? sug.aspectRatio
                    : null,
                  loop: typeof sug.loop === "boolean" ? sug.loop : null,
                  reason: s(sug.reason, 140),
                }
              : null,
        }),
      );
    }
    if (created.length) {
      st.batches.push({
        id: batchId,
        projectId: b.projectId!,
        kind,
        label:
          s(b.label, 60).trim() || (kind === "image" ? "Images" : "Animations"),
        createdAt: new Date().toISOString(),
      });
      st.items.push(...created);
    }
    return null;
  });
  return err ? fail(err, 404) : json({ created: created.length, batchId });
}
