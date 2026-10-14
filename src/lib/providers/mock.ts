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
    return [
      {
        id: "mock/image-alpha",
        name: "Mock image (transparent)",
        acceptsImageInput: true,
        transparent: true,
        maxReferences: 4,
      },
      {
        id: "mock/image-opaque",
        name: "Mock image (no alpha)",
        acceptsImageInput: true,
        transparent: false,
        maxReferences: 4,
      },
    ];
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
  async generateImage(req) {
    await realSleep(500);
    if (req.prompt.includes("[mock:reject]")) {
      throw new ProviderError("400: Mock rejection.", "rejected", 400);
    }
    if (req.prompt.includes("[mock:uncertain]")) {
      throw new ProviderError("No response (mock timeout).", "uncertain");
    }
    // Placeholder art: a green-screen plate when asked for chroma green,
    // otherwise a transparent PNG. Never the user's real character.
    const green = /chroma green/i.test(req.prompt);
    const file = path.join(
      process.cwd(),
      "assets",
      green ? "mock-plate.png" : "mock-image.png",
    );
    return {
      bytes: new Uint8Array(fs.readFileSync(file)),
      mediaType: "image/png",
      costUsd: 0,
    };
  },
  async chat(req) {
    await realSleep(300);
    if (req.system.includes("POSES_JSON")) {
      return JSON.stringify([
        {
          name: "Pointing",
          prompt:
            "The character points to the side with one arm, other arm relaxed.",
        },
        {
          name: "Thinking",
          prompt:
            "The character rests a hand on its chin, head slightly tilted.",
        },
        {
          name: "Celebrating",
          prompt: "The character raises both arms in a small celebration.",
        },
      ]);
    }
    if (req.system.includes("ANIMATIONS_JSON")) {
      return JSON.stringify([
        {
          name: "Hello wave",
          prompt: "The raised hand waves gently twice, then settles.",
          duration: 3,
          aspectRatio: "1:1",
          loop: true,
          reason: "short gesture: tight square loop",
        },
        {
          name: "Walk across",
          prompt: "The character walks steadily from left to right.",
          duration: 6,
          aspectRatio: "16:9",
          loop: false,
          reason: "travelling motion: landscape, longer, no loop",
        },
        {
          name: "Peek in",
          prompt:
            "The character leans in from the edge of the frame and smiles.",
          duration: 4,
          aspectRatio: "4:3",
          loop: false,
          reason: "entrance: plays once",
        },
      ]);
    }
    return `[mock helper] ${req.user.slice(0, 200)}`;
  },
};
