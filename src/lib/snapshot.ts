import { ffmpegStatus } from "./ffmpeg";
import {
  estimateVideoCost,
  resolveSettings,
  supportsLastFrame,
  validateSettings,
} from "./models";
import type { Provider } from "./providers/types";
import type { AppState, Item, Project, RunSnapshot } from "./types";

export interface PlanItem {
  id: string;
  name: string;
  kind: Item["kind"];
  errors: string[];
  notes: string[];
  snapshot: RunSnapshot | null;
  /** null = cost unavailable (pricing unknown or not per-second). */
  estimatedCostUsd: number | null;
}

export const CHROMA_CLAUSE = (hex: string) =>
  `The background must be a perfectly flat, uniform, solid chroma green (${hex.toUpperCase()}) with no shadows, gradients, reflections, texture or vignette, and no green tint or reflections on the subject.`;

export const TRANSPARENT_CLAUSE =
  "A single isolated subject on a transparent background, with no shadow or ground plane.";

export const LOOP_CLAUSE =
  "The motion must end exactly in the pose it started in, so the clip loops seamlessly.";

export function plateInstruction(hex: string): string {
  return `Re-render the reference image with the exact same subject, pose, proportions, colors, materials and rendering style, unchanged, but on a perfectly flat, uniform, solid chroma green (${hex.toUpperCase()}) background. No shadows, gradients, reflections or vignette; no green tint or reflections on the subject; keep a margin of empty background around the whole subject.`;
}

/** Other approved uploads in the project can help hold the style. */
function referencesFor(state: AppState, project: Project, max: number): Item[] {
  const anchor = state.items.find((i) => i.id === project.anchorId && i.file);
  const others = state.items.filter(
    (i) =>
      i.projectId === project.id &&
      i.kind === "image" &&
      i.origin === "upload" &&
      i.verdict === "kept" &&
      i.file &&
      i.id !== anchor?.id,
  );
  return [...(anchor ? [anchor] : []), ...others].slice(0, Math.max(0, max));
}

/**
 * Validate items against the chosen models and build exactly what would be
 * submitted. Reads model lists via `provider`; never makes a paid call.
 */
export async function planItems(
  state: AppState,
  provider: Provider,
  ids: string[],
): Promise<PlanItem[]> {
  const { settings } = state;
  const [videoModels, imageModels, ff] = await Promise.all([
    provider.listVideoModels(),
    provider.listImageModels(),
    ffmpegStatus(),
  ]);
  const vModel = videoModels.find((m) => m.id === settings.videoModel);
  const iModel = imageModels.find((m) => m.id === settings.imageModel);

  return ids.flatMap((id): PlanItem[] => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return [];
    const project = state.projects.find((p) => p.id === item.projectId);
    const base = {
      id,
      name: item.name,
      kind: item.kind,
      notes: [] as string[],
    };
    const errors: string[] = [];
    if (!project)
      return [
        {
          ...base,
          errors: ["Unknown project."],
          snapshot: null,
          estimatedCostUsd: null,
        },
      ];
    if (!item.prompt.trim()) errors.push("The prompt is empty.");

    // ---------- images ----------
    if (item.kind === "image") {
      if (!iModel) errors.push("Choose an image model first.");
      if (errors.length || !iModel) {
        return [{ ...base, errors, snapshot: null, estimatedCostUsd: null }];
      }
      const isPlate = item.origin === "plate";
      let refs: Item[];
      if (isPlate) {
        const src = state.items.find((i) => i.id === item.parentId && i.file);
        refs = src ? [src] : [];
        if (!src) errors.push("The source image is missing.");
      } else {
        const wanted = referencesFor(state, project, 4);
        if (
          wanted.length &&
          (!iModel.acceptsImageInput || iModel.maxReferences < 1)
        ) {
          errors.push(
            `${iModel.id} does not accept reference images, so it cannot match your style.`,
          );
        }
        refs = wanted.slice(0, Math.max(0, iModel.maxReferences));
        if (!project.anchorId && !refs.length) {
          base.notes.push(
            "No style anchor set: the model has nothing to match.",
          );
        }
      }
      let background: RunSnapshot["background"] = "none";
      let full = item.prompt;
      if (!isPlate) {
        // the pose/subject comes first, the style rules frame it
        full = [item.prompt.trim(), project.styleRules.trim()]
          .filter(Boolean)
          .join("\n\n");
        if (project.cutout) {
          if (iModel.transparent) {
            background = "native-alpha";
            full += `\n\n${TRANSPARENT_CLAUSE}`;
          } else {
            background = "chroma";
            full += `\n\n${CHROMA_CLAUSE(project.keyColor)}`;
            if (!ff.available)
              errors.push(
                "ffmpeg is needed to remove the green background for this model (brew install ffmpeg), or pick a model that supports transparency.",
              );
            else
              base.notes.push(
                `${iModel.id} cannot output transparency: it will render on green and the green is keyed out locally.`,
              );
          }
        }
      }
      const snapshot: RunSnapshot | null = errors.length
        ? null
        : {
            provider: provider.id,
            kind: "image",
            model: iModel.id,
            fullPrompt: full,
            refIds: refs.map((r) => r.id),
            refNames: refs.map((r) => r.name),
            background,
            startFrame: null,
            duration: 0,
            resolution: "",
            aspectRatio: item.aspectRatio,
            seed: null,
            generateAudio: null,
            loopMode: "none",
            keyColor: project.keyColor,
            estimatedCostUsd: null,
          };
      return [{ ...base, errors, snapshot, estimatedCostUsd: null }];
    }

    // ---------- clips ----------
    if (!vModel) errors.push("Choose a video model first.");
    const source = state.items.find((i) => i.id === item.sourceId);
    if (!source?.file) errors.push("The source image is missing.");
    else if (source.verdict !== "kept")
      errors.push(
        `Keep "${source.name}" in the Images tab before animating it.`,
      );
    let startFrame: RunSnapshot["startFrame"] = project.greenScreen
      ? "plate"
      : "image";
    let startItem: Item | undefined = source;
    if (source && project.greenScreen) {
      startItem = state.items.find(
        (i) => i.id === source.plateId && i.file && i.verdict === "kept",
      );
      if (!startItem)
        errors.push(
          `Prepare a green-screen version of "${source.name}" first (Animations tab).`,
        );
    }
    if (!vModel || errors.length) {
      return [{ ...base, errors, snapshot: null, estimatedCostUsd: null }];
    }
    errors.push(...validateSettings(item, vModel));
    const r = resolveSettings(item, vModel);
    if (r.aspectRatio && !ff.available)
      errors.push(
        "ffmpeg is needed to extend the image to that aspect ratio (brew install ffmpeg).",
      );
    const loopMode: RunSnapshot["loopMode"] = item.loop
      ? supportsLastFrame(vModel)
        ? "last-frame"
        : "prompt"
      : "none";
    if (loopMode === "prompt")
      base.notes.push(
        "This model has no last-frame control, so the loop relies on the prompt (best effort). You can ping-pong it on export.",
      );
    const cost = estimateVideoCost(vModel, {
      duration: r.duration,
      resolution: r.resolution,
      audio: r.generateAudio === true,
    });
    let full = item.prompt.trim();
    full = [full, project.animationRules.trim()].filter(Boolean).join("\n\n");
    if (item.loop) full += `\n\n${LOOP_CLAUSE}`;
    if (project.greenScreen) full += `\n\n${CHROMA_CLAUSE(project.keyColor)}`;
    const snapshot: RunSnapshot | null = errors.length
      ? null
      : {
          provider: provider.id,
          kind: "clip",
          model: vModel.id,
          fullPrompt: full,
          refIds: startItem ? [startItem.id] : [],
          refNames: source ? [source.name] : [],
          background: "none",
          startFrame,
          duration: r.duration ?? 0,
          resolution: r.resolution ?? "",
          aspectRatio: r.aspectRatio,
          seed: r.seed,
          generateAudio: r.generateAudio,
          loopMode,
          keyColor: project.keyColor,
          estimatedCostUsd: cost,
        };
    return [{ ...base, errors, snapshot, estimatedCostUsd: cost }];
  });
}
