import type { ChatModel, ImageModel, VideoModel } from "../types";

export interface VideoSubmitRequest {
  model: string;
  prompt: string;
  /** The video's starting frame, as a data URL. */
  firstFrameDataUrl: string;
  duration: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  seed: number | null;
  generateAudio: boolean | null;
}

export type RemoteStatus =
  "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";

export interface JobHandle {
  id: string;
  pollingUrl: string;
}

export interface PollResult {
  status: RemoteStatus;
  error?: string;
  costUsd?: number | null;
}

export interface StillRequest {
  model: string;
  prompt: string;
  /** First = the job's starting image; the rest = identity references. */
  images: { mediaType: string; bytes: Uint8Array }[];
  aspectRatio: string | null;
}

export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  images?: { mediaType: string; bytes: Uint8Array }[];
}

/** One adapter per provider; the queue only talks to this interface. */
export interface Provider {
  id: "openrouter" | "mock";
  label: string;
  listVideoModels(): Promise<VideoModel[]>;
  listImageModels(): Promise<ImageModel[]>;
  listChatModels(): Promise<ChatModel[]>;
  /** NOT retried by callers: a retry could double-charge. */
  submitVideo(req: VideoSubmitRequest): Promise<JobHandle>;
  pollVideo(h: JobHandle): Promise<PollResult>;
  downloadVideo(
    h: JobHandle,
  ): Promise<{ bytes: Uint8Array; contentType: string | null }>;
  generateStill(
    req: StillRequest,
  ): Promise<{ bytes: Uint8Array; mediaType: string; costUsd: number | null }>;
  chat(req: ChatRequest): Promise<string>;
}
