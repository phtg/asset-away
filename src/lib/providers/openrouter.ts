import { getApiKey } from "../keys";
import { redact } from "../redact";
import { ProviderError } from "../retry";
import { toDataUrl } from "../sniff";
import type { ChatModel, ImageModel, VideoModel } from "../types";
import type {
  ChatRequest,
  JobHandle,
  ImageRequest,
  PollResult,
  Provider,
  RemoteStatus,
  VideoSubmitRequest,
} from "./types";

// Verified against https://openrouter.ai/docs (video + image generation):
//   GET  /api/v1/videos/models        model capabilities + pricing_skus
//   POST /api/v1/videos               async job -> {id, polling_url, status}
//   GET  /api/v1/videos/{id}          poll -> status, usage.cost
//   GET  /api/v1/videos/{id}/content  download (needs the Authorization header)
//   POST /api/v1/images               image generation, base64 input_references
// There is NO documented idempotency key or cancel endpoint for video jobs.
const ORIGIN = "https://openrouter.ai";
const BASE = `${ORIGIN}/api/v1`;

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function secrets(): string[] {
  const k = getApiKey();
  return k ? [k] : [];
}

function requireKey(): string {
  const key = getApiKey();
  if (!key) {
    throw new ProviderError(
      "No OpenRouter API key. Set OPENROUTER_API_KEY or enter a session key.",
      "rejected",
    );
  }
  return key;
}

async function messageFrom(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let msg = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message ?? j?.message ?? msg;
  } catch {
    /* keep raw text */
  }
  return redact(`${res.status}: ${msg || res.statusText}`, secrets());
}

function retryAfter(res: Response): number | undefined {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? v * 1000 : undefined;
}

/** Read-style request: network/5xx/429 are retryable, other errors are not. */
async function readJson(
  url: string,
  init: RequestInit = {},
  auth = true,
): Promise<unknown> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  if (auth) headers.Authorization = `Bearer ${requireKey()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ProviderError(
      redact(`Network error: ${(e as Error).message}`, secrets()),
      "transient",
    );
  }
  if (res.ok) return res.json();
  const msg = await messageFrom(res);
  if (res.status === 429 || res.status >= 500) {
    throw new ProviderError(msg, "transient", res.status, retryAfter(res));
  }
  throw new ProviderError(msg, "fatal", res.status);
}

/**
 * Paid POST: a definite 4xx means nothing was started ("rejected"); anything
 * ambiguous (timeout, network drop, 5xx, unreadable body) is "uncertain".
 */
async function postPaid(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const key = requireKey();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ProviderError(
      redact(`No response (${(e as Error).message}).`, secrets()),
      "uncertain",
    );
  }
  if (res.ok) {
    try {
      return await res.json();
    } catch {
      throw new ProviderError(
        "Unreadable response from provider.",
        "uncertain",
      );
    }
  }
  const msg = await messageFrom(res);
  const definitive =
    res.status >= 400 && res.status < 500 && res.status !== 408;
  throw new ProviderError(
    msg,
    definitive ? "rejected" : "uncertain",
    res.status,
  );
}

// ---- model discovery ----

type Rec = Record<string, unknown>;
const arr = <T>(v: unknown): T[] | null =>
  Array.isArray(v) ? (v as T[]) : null;

export async function listVideoModels(): Promise<VideoModel[]> {
  return cached("video-models", async () => {
    const j = (await readJson(`${BASE}/videos/models`, {}, false)) as {
      data: Rec[];
    };
    return (j.data ?? []).map((m): VideoModel => ({
      id: String(m.id),
      name: String(m.name ?? m.id),
      supportedDurations: arr<number>(m.supported_durations),
      supportedResolutions: arr<string>(m.supported_resolutions),
      supportedAspectRatios: arr<string>(m.supported_aspect_ratios),
      supportedFrameImages: arr<string>(m.supported_frame_images),
      generateAudio:
        typeof m.generate_audio === "boolean" ? m.generate_audio : null,
      seed: typeof m.seed === "boolean" ? m.seed : null,
      pricingSkus: (m.pricing_skus as Record<string, string>) ?? null,
    }));
  });
}

export async function listImageModels(): Promise<ImageModel[]> {
  return cached("image-models", async () => {
    const j = (await readJson(`${BASE}/images/models`, {}, false)) as {
      data: Rec[];
    };
    return (j.data ?? []).map((m): ImageModel => {
      const arch = (m.architecture ?? {}) as Rec;
      const sp = (m.supported_parameters ?? {}) as Record<string, Rec>;
      const bgValues = arr<string>(sp.background?.values) ?? [];
      const refMax = Number((sp.input_references as Rec | undefined)?.max);
      return {
        id: String(m.id),
        name: String(m.name ?? m.id),
        acceptsImageInput: !!arr<string>(arch.input_modalities)?.includes(
          "image",
        ),
        transparent: bgValues.includes("transparent"),
        maxReferences: Number.isFinite(refMax) ? refMax : 0,
      };
    });
  });
}

export async function listChatModels(): Promise<ChatModel[]> {
  return cached("chat-models", async () => {
    const j = (await readJson(
      `${BASE}/models?input_modalities=image&output_modalities=text`,
      {},
      false,
    )) as { data: Rec[] };
    return (j.data ?? [])
      .map((m): ChatModel => {
        const price = Number((m.pricing as Rec | undefined)?.prompt);
        return {
          id: String(m.id),
          name: String(m.name ?? m.id),
          promptPrice: Number.isFinite(price) ? price : null,
        };
      })
      .filter((m) => !m.id.endsWith(":batch"));
  });
}

// ---- video ----

export async function submitVideo(req: VideoSubmitRequest): Promise<JobHandle> {
  const body: Rec = {
    model: req.model,
    prompt: req.prompt,
    frame_images: [
      {
        type: "image_url",
        image_url: { url: req.firstFrameDataUrl },
        frame_type: "first_frame",
      },
    ],
  };
  if (req.duration != null) body.duration = req.duration;
  if (req.resolution) body.resolution = req.resolution;
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.seed != null) body.seed = req.seed;
  if (req.generateAudio != null) body.generate_audio = req.generateAudio;
  if (req.lastFrameDataUrl) {
    (body.frame_images as Rec[]).push({
      type: "image_url",
      image_url: { url: req.lastFrameDataUrl },
      frame_type: "last_frame",
    });
  }

  const j = (await postPaid(`${BASE}/videos`, body, 90_000)) as Rec;
  if (typeof j.id !== "string" || !j.id) {
    throw new ProviderError("Provider response had no job id.", "uncertain");
  }
  return {
    id: j.id,
    pollingUrl: String(j.polling_url ?? `/api/v1/videos/${j.id}`),
  };
}

/** Only ever send the API key to openrouter.ai. */
function safePollingUrl(h: JobHandle): string {
  const url = new URL(h.pollingUrl, ORIGIN);
  if (url.origin !== ORIGIN) {
    throw new ProviderError("Unexpected polling URL host.", "fatal");
  }
  return url.toString();
}

const STATUSES: RemoteStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "expired",
];

export async function pollVideo(h: JobHandle): Promise<PollResult> {
  const j = (await readJson(safePollingUrl(h))) as Rec;
  const status = STATUSES.includes(j.status as RemoteStatus)
    ? (j.status as RemoteStatus)
    : "in_progress";
  const cost = (j.usage as Rec | undefined)?.cost;
  return {
    status,
    error: typeof j.error === "string" ? redact(j.error, secrets()) : undefined,
    costUsd: typeof cost === "number" ? cost : null,
  };
}

export async function downloadVideo(
  h: JobHandle,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const url = `${BASE}/videos/${encodeURIComponent(h.id)}/content?index=0`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${requireKey()}` },
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new ProviderError(
      redact(`Network error: ${(e as Error).message}`, secrets()),
      "transient",
    );
  }
  if (!res.ok) {
    const msg = await messageFrom(res);
    const retry = res.status === 429 || res.status >= 500;
    throw new ProviderError(
      msg,
      retry ? "transient" : "fatal",
      res.status,
      retryAfter(res),
    );
  }
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type"),
  };
}

// ---- stills (image-to-image) ----

export async function generateImage(req: ImageRequest) {
  const body: Rec = {
    model: req.model,
    prompt: req.prompt,
    n: 1,
  };
  if (req.images.length) {
    body.input_references = req.images.map((img) => ({
      type: "image_url",
      image_url: { url: toDataUrl(img.mediaType, img.bytes) },
    }));
  }
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.background === "transparent") {
    body.background = "transparent";
    body.output_format = "png";
  }
  const j = (await postPaid(`${BASE}/images`, body, 240_000)) as {
    data?: { b64_json?: string; media_type?: string }[];
    usage?: { cost?: number };
  };
  const first = j.data?.[0];
  if (!first?.b64_json) {
    throw new ProviderError("Provider returned no image.", "uncertain");
  }
  return {
    bytes: new Uint8Array(Buffer.from(first.b64_json, "base64")),
    mediaType: first.media_type ?? "image/png",
    costUsd: typeof j.usage?.cost === "number" ? j.usage.cost : null,
  };
}

// ---- optional text helpers (vision chat) ----

export async function chat(req: ChatRequest): Promise<string> {
  const content: Rec[] = [{ type: "text", text: req.user }];
  for (const img of req.images ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: toDataUrl(img.mediaType, img.bytes) },
    });
  }
  const j = (await postPaid(
    `${BASE}/chat/completions`,
    {
      model: req.model,
      max_tokens: 1500,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content },
      ],
    },
    90_000,
  )) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError("Model returned no text.", "rejected");
  return text.trim();
}

export const openrouter: Provider = {
  id: "openrouter",
  label: "OpenRouter",
  listVideoModels,
  listImageModels,
  listChatModels,
  submitVideo,
  pollVideo,
  downloadVideo,
  generateImage,
  chat,
};
