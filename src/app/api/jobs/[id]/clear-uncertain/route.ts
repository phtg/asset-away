import { fail, getRunner, json } from "@/lib/server";

/** The user verified with the provider that nothing was started. */
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
    await getRunner().markNotSubmitted(id);
    return json({ ok: true });
  } catch (e) {
    return fail((e as Error).message, 409);
  }
}
