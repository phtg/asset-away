import { fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";

/** Keep / reject / reset. Keeping a plate makes it the image's green screen. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { verdict?: string } | null;
  if (!["kept", "rejected", "pending"].includes(b?.verdict ?? ""))
    return fail("Bad verdict");
  const store = getStore();
  const ok = await store.update((s) => {
    const it = s.items.find((x) => x.id === id);
    if (!it || it.state !== "completed") return false;
    it.verdict = b!.verdict as "kept" | "rejected" | "pending";
    if (it.origin === "plate" && it.parentId) {
      const parent = s.items.find((x) => x.id === it.parentId);
      if (parent) {
        if (it.verdict === "kept") parent.plateId = it.id;
        else if (parent.plateId === it.id) parent.plateId = null;
      }
    }
    return true;
  });
  return ok
    ? json({ ok: true })
    : fail("Only finished items can be reviewed.", 409);
}
