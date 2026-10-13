import type { AppState, ChatModel, ImageModel, VideoModel } from "@/lib/types";

export async function api<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export const post = <T = unknown>(url: string, body?: unknown) =>
  api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const patch = <T = unknown>(url: string, body: unknown) =>
  api<T>(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export interface ServerState extends Pick<
  AppState,
  "settings" | "images" | "jobs"
> {
  keySource: "env" | "session" | "none";
  mock: boolean;
  mockForcedByEnv: boolean;
  provider: { id: string; label: string };
  maxUploadMb: number;
  activeCount: number;
}

export interface ModelLists {
  provider: string;
  video: VideoModel[];
  image: ImageModel[];
  chat: ChatModel[];
}

export interface PlanResponse {
  provider: { id: string; label: string };
  videoModel: string | null;
  stillModel: string | null;
  concurrency: number;
  autoApproveStills: boolean;
  items: {
    id: string;
    name: string;
    errors: string[];
    ready: boolean;
    estimatedCostUsd: number | null;
    startsWithStill: boolean;
  }[];
  totalEstimatedUsd: number | null;
  partialUsd: number;
  unknownCount: number;
}

export const money = (n: number | null | undefined) =>
  n == null ? "Cost unavailable" : `$${n.toFixed(n < 1 ? 3 : 2)}`;
