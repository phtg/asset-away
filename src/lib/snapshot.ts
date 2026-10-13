import { estimateVideoCost, resolveSettings, validateSettings } from "./models";
import { composePrompt } from "./parse";
import type { Provider } from "./providers/types";
import type { AppState, Job, RunSnapshot } from "./types";

export interface PlanItem {
  id: string;
  name: string;
  errors: string[];
  snapshot: RunSnapshot | null;
  /** null = cost unavailable (pricing not understood or not published). */
  estimatedCostUsd: number | null;
  startsWithStill: boolean;
}

/**
 * Validate jobs against the selected models and build exactly what would be
 * submitted. Pure with respect to the store; reads model lists via `provider`.
 */
export async function planJobs(
  state: AppState,
  provider: Provider,
  ids: string[],
): Promise<PlanItem[]> {
  const { settings } = state;
  const videoModels = await provider.listVideoModels();
  const model = videoModels.find((m) => m.id === settings.videoModel);

  return ids.flatMap((id): PlanItem[] => {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return [];
    const errors: string[] = [];
    if (!model) errors.push("Choose a video model first.");
    if (!job.actionPrompt.trim()) errors.push("The motion prompt is empty.");
    const img = state.images.find(
      (i) => i.id === (job.startImageId ?? settings.defaultImageId),
    );
    const hasApprovedStill = job.mode === "prepare" && job.still?.approved;
    if (!img && !hasApprovedStill) errors.push("No starting image selected.");
    if (job.mode === "prepare" && !hasApprovedStill) {
      if (!settings.stillModel)
        errors.push("Choose an image model for stills.");
      if (!job.stillPrompt.trim())
        errors.push("The starting-image prompt is empty.");
    }
    if (!model) {
      return [
        {
          id,
          name: job.name,
          errors,
          snapshot: null,
          estimatedCostUsd: null,
          startsWithStill: false,
        },
      ];
    }
    errors.push(...validateSettings(job, model));
    const r = resolveSettings(job, model);
    const cost = estimateVideoCost(model, {
      duration: r.duration,
      resolution: r.resolution,
      audio: r.generateAudio === true,
    });
    const snapshot: RunSnapshot | null = errors.length
      ? null
      : {
          provider: provider.id,
          videoModel: model.id,
          stillModel: job.mode === "prepare" ? settings.stillModel : null,
          sharedInstructions: settings.sharedInstructions,
          fullVideoPrompt: composePrompt(
            settings.sharedInstructions,
            job.actionPrompt,
          ),
          fullStillPrompt:
            job.mode === "prepare"
              ? composePrompt(settings.sharedInstructions, job.stillPrompt)
              : null,
          startImageName: img?.name ?? null,
          duration: r.duration ?? 0,
          resolution: r.resolution ?? "",
          aspectRatio: r.aspectRatio,
          seed: r.seed,
          generateAudio: r.generateAudio,
          estimatedCostUsd: cost,
        };
    return [
      {
        id,
        name: job.name,
        errors,
        snapshot,
        estimatedCostUsd: cost,
        startsWithStill: job.mode === "prepare" && !hasApprovedStill,
      },
    ];
  });
}

export function jobSummaryLine(job: Job): string {
  return `${job.name} (${job.state})`;
}
