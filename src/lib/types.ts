// ---- Items: one record for every image and every clip ----

export type ItemKind = "image" | "clip";

/** Pipeline state (machine-driven). */
export type ItemState =
  | "draft"
  | "queued"
  | "submitting"
  | "generating"
  | "downloading"
  | "completed"
  | "failed"
  | "submission_uncertain";

/** Human review decision (independent of pipeline state). */
export type Verdict = "pending" | "kept" | "rejected";

export type Origin = "upload" | "generated" | "plate" | "clip";

export interface FileInfo {
  file: string; // images -> data/images, clips -> data/outputs
  mediaType: string;
  bytes: number;
  format: string; // detected container: png, jpg, webp, mp4, ...
  width: number | null;
  height: number | null;
  hasAlpha: boolean;
  contentType: string | null; // as reported by the provider
}

/** What the helper model recommended for an animation (shown, editable). */
export interface Suggestion {
  duration: number | null;
  aspectRatio: string | null;
  loop: boolean | null;
  reason: string;
}

export interface RunSnapshot {
  provider: "openrouter" | "mock";
  kind: ItemKind;
  model: string;
  fullPrompt: string;
  refIds: string[]; // images sent (references / starting frame source)
  refNames: string[];
  /** images: how the background is produced */
  background: "native-alpha" | "chroma" | "none";
  /** clips: which image becomes the first frame */
  startFrame: "plate" | "image" | null;
  duration: number;
  resolution: string;
  aspectRatio: string | null;
  seed: number | null;
  generateAudio: boolean | null;
  loopMode: "last-frame" | "prompt" | "none";
  keyColor: string;
  estimatedCostUsd: number | null;
}

export interface Item {
  id: string;
  projectId: string;
  kind: ItemKind;
  origin: Origin;
  order: number;
  batchId: string | null;
  name: string;
  prompt: string;
  include: boolean; // ticked for the next "Generate selected"
  verdict: Verdict;

  parentId: string | null; // plate -> its source image; regenerated -> previous
  plateId: string | null; // image -> its kept green-screen plate
  sourceId: string | null; // clip -> the image it animates

  // clip settings (null = decide from suggestion / model default)
  duration: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  seed: number | null;
  loop: boolean;
  suggestion: Suggestion | null;

  state: ItemState;
  error: string | null;
  uncertainStage: "image" | "video" | null;
  run: RunSnapshot | null;

  providerJobId: string | null;
  pollingUrl: string | null;
  providerStatus: string | null;
  pollError: string | null;
  costUsd: number | null;

  file: FileInfo | null;

  createdAt: string;
  queuedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
}

export interface Batch {
  id: string;
  projectId: string;
  kind: ItemKind;
  label: string;
  createdAt: string;
}

export type ProjectKind = "mascot" | "icon" | "illustration" | "other";

export interface Project {
  id: string;
  name: string;
  kind: ProjectKind;
  /** Plain-language description of the asset style. */
  brief: string;
  /** Appended to every image prompt. */
  styleRules: string;
  /** Appended to every animation prompt. */
  animationRules: string;
  /** Subject isolated on a removable background (vs. a full scene). */
  cutout: boolean;
  /** Animate on a flat key colour so clips can be keyed out later. */
  greenScreen: boolean;
  keyColor: string; // e.g. #00ff00
  /** Default export background. */
  background: { mode: "transparent" | "color"; color: string };
  anchorId: string | null;
  createdAt: string;
}

export interface Settings {
  concurrency: number;
  mock: boolean;
  videoModel: string | null;
  imageModel: string | null;
  helperModel: string | null;
  savedColors: string[];
  activeProjectId: string | null;
}

export interface AppState {
  version: 2;
  settings: Settings;
  projects: Project[];
  batches: Batch[];
  items: Item[];
}

// ---- provider model descriptions ----

export interface VideoModel {
  id: string;
  name: string;
  supportedDurations: number[] | null;
  supportedResolutions: string[] | null;
  supportedAspectRatios: string[] | null;
  supportedFrameImages: string[] | null;
  generateAudio: boolean | null;
  seed: boolean | null;
  pricingSkus: Record<string, string> | null;
}

export interface ImageModel {
  id: string;
  name: string;
  acceptsImageInput: boolean;
  /** Can output a real alpha channel (`background: transparent`). */
  transparent: boolean;
  maxReferences: number;
}

export interface ChatModel {
  id: string;
  name: string;
  promptPrice: number | null; // USD per token
}

// ---- defaults ----

export const DEFAULT_ANIMATION_RULES =
  "Smooth, friendly mechanical motion. Rigid body panels move at their joints rather than bending. Fixed camera, unchanged flat background, consistent lighting. Keep the whole subject inside the frame at all times with a margin around it. No cuts, text, extra limbs, or new decorative elements.";

export const DEFAULT_STYLE_RULES: Record<ProjectKind, string> = {
  mascot:
    "Keep the character's exact appearance, proportions, materials, outfit and accessories from the reference. Same rendering style and soft studio lighting across the whole set. Full body in frame with a margin around it. One subject only; no text and no extra decorative elements.",
  icon: "Consistent icon style across the set: same line weight, corner radius, palette and level of detail as the reference. Centered single object with generous padding. No text.",
  illustration:
    "Match the reference's illustration style: same palette, shading, line quality and level of detail. No text or watermarks.",
  other:
    "Match the reference's style closely and keep it consistent across the set.",
};

export const DEFAULT_KEY_COLOR = "#00ff00";

export const DEFAULT_SETTINGS: Settings = {
  concurrency: 2,
  mock: false,
  videoModel: null,
  imageModel: null,
  helperModel: null,
  savedColors: ["#e60167"],
  activeProjectId: null,
};

export const ACTIVE_STATES: ItemState[] = [
  "submitting",
  "generating",
  "downloading",
];
