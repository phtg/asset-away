import { fail, getRunner, json } from "@/lib/server";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    await getRunner().approveStill(id);
    return json({ ok: true });
  } catch (e) {
    return fail((e as Error).message, 409);
  }
}
