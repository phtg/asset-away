import fs from "node:fs";
import path from "node:path";
import { ProviderError, realSleep } from "../retry";
import type { ChatModel, ImageModel, VideoModel } from "../types";
import type { JobHandle, PollResult, Provider } from "./types";

/**
 * MOCK PROVIDER - no network, no cost. Used to exercise the queue and the UI.
 * Magic markers anywhere in a prompt trigger behaviours:
 *   [mock:reject]    submission is refused (nothing started)
 *   [mock:uncertain] submission gets no answer ("submission uncertain")
 *   [mock:fail]      the job fails while generating
 * Progress is derived from the timestamp inside the job id, so it keeps
 * working across server restarts (resume testing).
 */
const DELAY_MS = () => Number(process.env.MOCK_DELAY_MS) || 6000;

const VIDEO_MODELS: VideoModel[] = [
  {
    id: "mock/clip-fast",
    name: "Mock: clip-fast (no real generation)",
    supportedDurations: [3, 4, 5],
    supportedResolutions: ["480p", "720p"],
    supportedAspectRatios: ["16:9", "1:1"],
    supportedFrameImages: ["first_frame"],
    generateAudio: false,
    seed: true,
    pricingSkus: {
      duration_seconds_480p: "0.02",
      duration_seconds_720p: "0.04",
    },
  },
  {
    id: "mock/token-priced",
    name: "Mock: token-priced (cost unavailable)",
    supportedDurations: [4, 6],
    supportedResolutions: ["480p"],
    supportedAspectRatios: null,
    supportedFrameImages: ["first_frame"],
    generateAudio: null,
    seed: null,
    pricingSkus: { video_tokens: "0.000005" },
  },
];

function encode(prompt: string): string {
  const flag = prompt.includes("[mock:fail]") ? "f" : "ok";
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${flag}`;
}

export const mock: Provider = {
  id: "mock",
  label: "MOCK (no real provider)",
  async listVideoModels() {
    return VIDEO_MODELS;
  },
  async listImageModels(): Promise<ImageModel[]> {
    return [{ id: "mock/still", name: "Mock still", acceptsImageInput: true }];
  },
  async listChatModels(): Promise<ChatModel[]> {
    return [{ id: "mock/helper", name: "Mock helper", promptPrice: 0 }];
  },
  async submitVideo(req): Promise<JobHandle> {
    await realSleep(300);
    if (req.prompt.includes("[mock:reject]")) {
      throw new ProviderError(
        "400: Mock rejection (nothing was started).",
        "rejected",
        400,
      );
    }
    if (req.prompt.includes("[mock:uncertain]")) {
      throw new ProviderError("No response (mock timeout).", "uncertain");
    }
    const id = encode(req.prompt);
    return { id, pollingUrl: `/mock/${id}` };
  },
  async pollVideo(h): Promise<PollResult> {
    const ts = Number(h.id.split("-")[1]);
    const elapsed = Date.now() - ts;
    const fails = h.id.endsWith("-f");
    if (elapsed < DELAY_MS() / 3) return { status: "pending" };
    if (elapsed < DELAY_MS()) return { status: "in_progress" };
    return fails
      ? { status: "failed", error: "Mock failure (content policy)." }
      : { status: "completed", costUsd: 0 };
  },
  async downloadVideo() {
    const bytes = fs.readFileSync(
      path.join(process.cwd(), "assets", "mock-sample.mp4"),
    );
    return { bytes: new Uint8Array(bytes), contentType: "video/mp4" };
  },
  async generateStill(req) {
    await realSleep(500);
    if (req.prompt.includes("[mock:reject]")) {
      throw new ProviderError("400: Mock rejection.", "rejected", 400);
    }
    if (req.prompt.includes("[mock:uncertain]")) {
      throw new ProviderError("No response (mock timeout).", "uncertain");
    }
    // The "generated" still is just the starting image again.
    const first = req.images[0];
    return { bytes: first.bytes, mediaType: first.mediaType, costUsd: 0 };
  },
  async chat(req) {
    await realSleep(300);
    if (req.system.includes("ANIMATION_IDEAS")) {
      return [
        "Thinking",
        "The robot tilts its head, pauses, then returns to its starting pose.",
        "---",
        "Hello wave",
        "The robot gently waves its raised hand twice, then returns to its starting pose.",
      ].join("\n");
    }
    return `[mock helper] ${req.user.slice(0, 200)}`;
  },
};
