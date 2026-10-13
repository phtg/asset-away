export type JobState =
  | "draft"
  | "queued"
  | "preparing_image"
  | "awaiting_image_approval"
  | "submitting"
  | "generating"
  | "downloading"
  | "completed"
  | "failed"
  | "submission_uncertain";

export type JobMode = "animate" | "prepare";

export interface ImageRecord {
  id: string;
  name: string;
  file: string; // filename inside data/images
  mediaType: string;
  bytes: number;
  /** Used as an identity reference when preparing starting images. */
  identityRef: boolean;
  createdAt: string;
}

export interface StillInfo {
  file: string; // filename inside data/stills
  mediaType: string;
  approved: boolean;
  costUsd: number | null;
  createdAt: string;
}

export interface OutputInfo {
  file: string; // filename inside data/outputs
  bytes: number;
  format: string; // detected container, e.g. "mp4"
  contentType: string | null; // as reported by the provider
}

export interface Job {
  id: string;
  order: number;
  name: string;
  include: boolean;
  mode: JobMode;
  /** null = use the default starting image. */
  startImageId: string | null;
  actionPrompt: string;
  stillPrompt: string;
  /** null = model default (nearest supported to 4s). */
  duration: number | null;
  /** null = model default (480p when supported). */
  resolution: string | null;
  aspectRatio: string | null;
  seed: number | null;

  state: JobState;
  error: string | null;
  /** Stage that was in flight when the submission became uncertain. */
  uncertainStage: "still" | "video" | null;

  // Snapshot taken when the job was queued.
  run: RunSnapshot | null;

  still: StillInfo | null;
  providerJobId: string | null;
  pollingUrl: string | null;
  providerStatus: string | null;
  pollError: string | null;
  costUsd: number | null;
  output: OutputInfo | null;

  createdAt: string;
  queuedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
}

/** Everything that was actually submitted, for the manifest and for resuming. */
export interface RunSnapshot {
  provider: "openrouter" | "mock";
  videoModel: string;
  stillModel: string | null;
  sharedInstructions: string;
  fullVideoPrompt: string;
  fullStillPrompt: string | null;
  startImageName: string | null;
  duration: number;
  resolution: string;
  aspectRatio: string | null;
  seed: number | null;
  generateAudio: boolean | null;
  estimatedCostUsd: number | null;
}

export interface Settings {
  sharedInstructions: string;
  defaultImageId: string | null;
  videoModel: string | null;
  stillModel: string | null;
  helperModel: string | null;
  concurrency: number;
  /** Chain the paid video call right after a still is generated. */
  autoApproveStills: boolean;
  mock: boolean;
}

export interface AppState {
  version: 1;
  settings: Settings;
  images: ImageRecord[];
  jobs: Job[];
}

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
}

export interface ChatModel {
  id: string;
  name: string;
  promptPrice: number | null; // USD per token
}

export const DEFAULT_SHARED_INSTRUCTIONS =
  "Preserve the reference robot's appearance, proportions, materials, outfit, headset, and cyan digital face. Smooth, friendly mechanical motion. Rigid body panels move at their joints rather than bending. Fixed camera, unchanged plain background, consistent lighting. Keep gestures inside the frame. No cuts, text, extra limbs, or new decorative elements.";

export const DEFAULT_SETTINGS: Settings = {
  sharedInstructions: DEFAULT_SHARED_INSTRUCTIONS,
  defaultImageId: null,
  videoModel: null,
  stillModel: null,
  helperModel: null,
  concurrency: 2,
  autoApproveStills: false,
  mock: false,
};

export const ACTIVE_STATES: JobState[] = [
  "preparing_image",
  "submitting",
  "generating",
  "downloading",
];
