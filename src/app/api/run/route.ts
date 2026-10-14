import { redact } from "@/lib/redact";
import { currentProvider, fail, getRunner, json } from "@/lib/server";
import { planItems } from "@/lib/snapshot";
import { getStore } from "@/lib/store";

/** Queue confirmed items. Requires explicit `confirm: true`. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    ids?: string[];
    confirm?: boolean;
  } | null;
  if (!body?.confirm) return fail("Confirmation required.", 400);
  if (!body.ids?.length) return fail("Nothing selected.");
  try {
    const plan = await planItems(getStore().get(), currentProvider(), body.ids);
    const ready = plan.filter((p) => p.snapshot);
    const result = await getRunner().queue(
      ready.map((p) => ({ id: p.id, snapshot: p.snapshot! })),
    );
    return json({
      ...result,
      invalid: plan
        .filter((p) => !p.snapshot)
        .map((p) => ({ id: p.id, errors: p.errors })),
    });
  } catch (e) {
    return fail(redact((e as Error).message), 502);
  }
}
