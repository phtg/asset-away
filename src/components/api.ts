import type {
  Batch,
  ChatModel,
  ImageModel,
  Item,
  Project,
  Settings,
  VideoModel,
} from "@/lib/types";

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

export interface ServerState {
  settings: Settings;
  projects: { id: string; name: string; kind: string; count: number }[];
  project: Project;
  batches: Batch[];
  items: Item[];
  keySource: "env" | "session" | "none";
  mock: boolean;
  mockForcedByEnv: boolean;
  provider: { id: string; label: string };
  ffmpeg: { available: boolean; version: string | null };
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
  imageModel: string | null;
  concurrency: number;
  items: {
    id: string;
    name: string;
    kind: "image" | "clip";
    errors: string[];
    notes: string[];
    ready: boolean;
    fullPrompt: string | null;
    estimatedCostUsd: number | null;
  }[];
  totalEstimatedUsd: number | null;
  partialUsd: number;
  unknownCount: number;
}

export const money = (n: number | null | undefined) =>
  n == null ? "Cost unavailable" : `$${n.toFixed(n < 1 ? 3 : 2)}`;

/** Props every tab receives. */
export interface TabProps {
  state: ServerState;
  models: ModelLists | null;
  refresh: () => void;
  /** Open the review viewer on an item, within an ordered list. */
  review: (id: string, list: string[]) => void;
  /** Open the confirm-and-run dialog for these item ids. */
  run: (ids: string[]) => void;
  goto: (tab: Tab) => void;
}

export type Tab = "style" | "images" | "animations" | "library";
