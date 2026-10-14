import { redact } from "@/lib/redact";
import { currentProvider, fail, getRunner, json } from "@/lib/server";
import { planItems } from "@/lib/snapshot";
import { getStore } from "@/lib/store";

/** Retry one failed item. Requires explicit confirmation (it may cost money). */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    confirm?: boolean;
  } | null;
  if (!body?.confirm) return fail("Confirmation required.");
  try {
    const [item] = await planItems(getStore().get(), currentProvider(), [id]);
    if (!item) return fail("Unknown item", 404);
    if (!item.snapshot) return fail(item.errors.join(" "), 422);
    await getRunner().retry(id, item.snapshot);
    return json({ ok: true });
  } catch (e) {
    return fail(redact((e as Error).message), 409);
  }
}
