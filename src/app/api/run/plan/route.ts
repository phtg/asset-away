import { redact } from "@/lib/redact";
import { currentProvider, fail, json } from "@/lib/server";
import { planItems } from "@/lib/snapshot";
import { getStore } from "@/lib/store";

/** Dry run for the confirmation dialog. Makes no paid calls. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    ids?: string[];
  } | null;
  if (!body?.ids?.length) return fail("Nothing selected.");
  const state = getStore().get();
  const provider = currentProvider();
  try {
    const items = await planItems(state, provider, body.ids);
    const clips = items.filter((i) => i.kind === "clip");
    const known = clips.filter((i) => i.estimatedCostUsd != null);
    return json({
      provider: { id: provider.id, label: provider.label },
      videoModel: state.settings.videoModel,
      imageModel: state.settings.imageModel,
      concurrency: state.settings.concurrency,
      items: items.map(({ snapshot, ...rest }) => ({
        ...rest,
        ready: !!snapshot,
        fullPrompt: snapshot?.fullPrompt ?? null,
      })),
      // Only a sum when every clip has a trustworthy estimate.
      totalEstimatedUsd:
        clips.length &&
        known.length === clips.length &&
        items.length === clips.length
          ? Math.round(
              known.reduce((a, i) => a + (i.estimatedCostUsd ?? 0), 0) * 10000,
            ) / 10000
          : null,
      partialUsd: known.reduce((a, i) => a + (i.estimatedCostUsd ?? 0), 0),
      unknownCount: items.length - known.length,
    });
  } catch (e) {
    return fail(
      redact(`Could not check the models: ${(e as Error).message}`),
      502,
    );
  }
}
