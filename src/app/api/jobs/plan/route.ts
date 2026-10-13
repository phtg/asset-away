import { fail, currentProvider, json } from "@/lib/server";
import { planJobs } from "@/lib/snapshot";
import { getStore } from "@/lib/store";
import { redact } from "@/lib/redact";

/** Dry run for the confirmation dialog. Makes no paid calls. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    ids?: string[];
  } | null;
  if (!body?.ids?.length) return fail("No jobs selected.");
  const state = getStore().get();
  const provider = currentProvider();
  try {
    const items = await planJobs(state, provider, body.ids);
    const known = items.filter((i) => i.estimatedCostUsd != null);
    return json({
      provider: { id: provider.id, label: provider.label },
      videoModel: state.settings.videoModel,
      stillModel: state.settings.stillModel,
      concurrency: state.settings.concurrency,
      autoApproveStills: state.settings.autoApproveStills,
      items: items.map(({ snapshot, ...rest }) => ({
        ...rest,
        snapshot: undefined,
        ready: !!snapshot,
      })),
      // Only a sum when every job has a trustworthy estimate.
      totalEstimatedUsd:
        known.length === items.length && items.length
          ? Math.round(
              known.reduce((a, i) => a + (i.estimatedCostUsd ?? 0), 0) * 10000,
            ) / 10000
          : null,
      partialUsd: known.reduce((a, i) => a + (i.estimatedCostUsd ?? 0), 0),
      unknownCount: items.length - known.length,
    });
  } catch (e) {
    return fail(
      redact(`Could not check the model: ${(e as Error).message}`),
      502,
    );
  }
}
