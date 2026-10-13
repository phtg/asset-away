import type { Job, VideoModel } from "./types";

const RES_ORDER = ["360p", "480p", "720p", "768p", "1080p", "1K", "2K", "4K"];

export const TARGET_SECONDS = 4;

export function nearestDuration(
  supported: number[] | null | undefined,
  target = TARGET_SECONDS,
): number | null {
  if (!supported || supported.length === 0) return null;
  return supported.reduce((best, d) =>
    Math.abs(d - target) < Math.abs(best - target) ||
    (Math.abs(d - target) === Math.abs(best - target) && d < best)
      ? d
      : best,
  );
}

export function defaultResolution(
  supported: string[] | null | undefined,
): string | null {
  if (!supported || supported.length === 0) return null;
  if (supported.includes("480p")) return "480p";
  return [...supported].sort(
    (a, b) => RES_ORDER.indexOf(a) - RES_ORDER.indexOf(b),
  )[0];
}

export function supportsFirstFrame(m: VideoModel): boolean {
  return !!m.supportedFrameImages?.includes("first_frame");
}

export interface ResolvedSettings {
  duration: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  seed: number | null;
  generateAudio: boolean | null;
}

export function resolveSettings(
  job: Pick<Job, "duration" | "resolution" | "aspectRatio" | "seed">,
  model: VideoModel,
): ResolvedSettings {
  return {
    duration: job.duration ?? nearestDuration(model.supportedDurations),
    resolution: job.resolution ?? defaultResolution(model.supportedResolutions),
    aspectRatio: job.aspectRatio,
    // Only models that can produce audio get an explicit "no audio" request.
    seed: model.seed === true ? job.seed : null,
    generateAudio: model.generateAudio === true ? false : null,
  };
}

/** Human-readable problems with sending this job to this model. */
export function validateSettings(
  job: Pick<Job, "duration" | "resolution" | "aspectRatio" | "seed">,
  model: VideoModel,
): string[] {
  const errs: string[] = [];
  const r = resolveSettings(job, model);
  if (!supportsFirstFrame(model)) {
    errs.push(`${model.id} does not accept a starting image (first_frame).`);
  }
  if (
    r.duration != null &&
    model.supportedDurations &&
    !model.supportedDurations.includes(r.duration)
  ) {
    errs.push(
      `Duration ${r.duration}s is not supported (use ${model.supportedDurations.join(", ")}).`,
    );
  }
  if (
    r.resolution != null &&
    model.supportedResolutions &&
    !model.supportedResolutions.includes(r.resolution)
  ) {
    errs.push(
      `Resolution ${r.resolution} is not supported (use ${model.supportedResolutions.join(", ")}).`,
    );
  }
  if (
    r.aspectRatio &&
    model.supportedAspectRatios &&
    !model.supportedAspectRatios.includes(r.aspectRatio)
  ) {
    errs.push(
      `Aspect ratio ${r.aspectRatio} is not supported (use ${model.supportedAspectRatios.join(", ")}).`,
    );
  }
  if (job.seed != null && model.seed !== true) {
    errs.push("This model does not support a seed.");
  }
  return errs;
}

/**
 * Estimate USD cost from OpenRouter's `pricing_skus`. Only simple per-second
 * SKUs are understood; anything else (token-based, etc.) returns null, which
 * the UI shows as "Cost unavailable". The real cost is read from the finished
 * job's `usage.cost`.
 */
export function estimateVideoCost(
  model: VideoModel,
  s: { duration: number | null; resolution: string | null; audio: boolean },
): number | null {
  const skus = model.pricingSkus;
  if (!skus || s.duration == null) return null;
  const res = s.resolution?.toLowerCase() ?? "";
  const num = (k: string): number | null => {
    const v = skus[k];
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const perSecondUsd: (number | null)[] = [];
  const audioKeys = s.audio
    ? [`duration_seconds_with_audio_${res}`, "duration_seconds_with_audio"]
    : [
        `duration_seconds_without_audio_${res}`,
        "duration_seconds_without_audio",
      ];
  for (const k of audioKeys) perSecondUsd.push(num(k));
  for (const k of [
    `duration_seconds_${res}`,
    `image_to_video_duration_seconds_${res}`,
    "duration_seconds",
  ]) {
    perSecondUsd.push(num(k));
  }
  for (const k of [
    `cents_per_video_output_second_${res}`,
    `cents_per_second_output_${res}`,
    "cents_per_second_output",
  ]) {
    const c = num(k);
    perSecondUsd.push(c == null ? null : c / 100);
  }
  const rate = perSecondUsd.find((v) => v != null);
  if (rate == null) return null;
  const inputImage = (num("cents_per_image_input") ?? 0) / 100;
  return Math.round((rate * s.duration + inputImage) * 10000) / 10000;
}
