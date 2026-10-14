"use client";

import { useState } from "react";
import {
  defaultResolution,
  estimateVideoCost,
  nearestDuration,
  supportsFirstFrame,
} from "@/lib/models";
import { Btn } from "./ui";
import {
  api,
  money,
  patch,
  post,
  type ModelLists,
  type ServerState,
} from "./api";

export function SettingsDialog({
  state,
  models,
  refresh,
  onClose,
}: {
  state: ServerState;
  models: ModelLists | null;
  refresh: () => void;
  onClose: () => void;
}) {
  const s = state.settings;
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (p: Record<string, unknown>) => {
    setErr(null);
    try {
      await patch("/api/settings", p);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const saveKey = async (k: string | null) => {
    setErr(null);
    try {
      await post("/api/key", { key: k });
      setKey("");
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const priced = (models?.video ?? [])
    .filter(supportsFirstFrame)
    .map((m) => ({
      m,
      cost: estimateVideoCost(m, {
        duration: nearestDuration(m.supportedDurations),
        resolution: defaultResolution(m.supportedResolutions),
        audio: false,
      }),
    }))
    .sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99));
  const imageModels = (models?.image ?? []).filter(
    (m) => m.acceptsImageInput && m.maxReferences > 0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Settings</h3>
          <Btn kind="ghost" onClick={onClose}>
            Close
          </Btn>
        </div>

        <section className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-medium">
            OpenRouter API key:{" "}
            {state.keySource === "env" && (
              <span className="text-emerald-700">set in .env.local ✓</span>
            )}
            {state.keySource === "session" && (
              <span className="text-emerald-700">
                session key (server memory) ✓
              </span>
            )}
            {state.keySource === "none" && (
              <span className="text-rose-700">missing</span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            OpenRouter runs everything here: images, videos and the prompt
            helpers. An API key is separate from any chat subscription (Claude,
            ChatGPT…): create one at openrouter.ai/keys and add credits.
          </p>
          {state.keySource === "env" && !showKey ? (
            <button
              className="mt-2 text-xs text-sky-700 underline"
              onClick={() => setShowKey(true)}
            >
              Use a different key for this session only
            </button>
          ) : (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) void saveKey(key.trim());
              }}
            >
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-or-… (kept in server memory only)"
                className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <Btn kind="primary" type="submit">
                Use
              </Btn>
              {state.keySource === "session" && (
                <Btn onClick={() => saveKey(null)}>Forget</Btn>
              )}
            </form>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Prefer <code>.env.local</code>. A session key is never stored in the
            browser, a URL or a file.
          </p>
        </section>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Video model</span>
            <select
              value={s.videoModel ?? ""}
              onChange={(e) => save({ videoModel: e.target.value || null })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            >
              <option value="">Choose…</option>
              {priced.map(({ m, cost }) => (
                <option key={m.id} value={m.id}>
                  {m.id} —{" "}
                  {cost == null ? "cost unavailable" : `~${money(cost)}/clip`}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Live list; only models that accept a starting image. Estimates use
              published per-second prices.
            </span>
          </label>

          <label className="block text-sm">
            <span className="font-medium">Image model</span>
            <select
              value={s.imageModel ?? ""}
              onChange={(e) => save({ imageModel: e.target.value || null })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            >
              <option value="">Choose…</option>
              {imageModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}{" "}
                  {m.transparent
                    ? "· transparent PNG"
                    : "· opaque (green-keyed)"}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Needs to accept reference images. “Transparent” models draw a real
              alpha channel; others are keyed from green locally.
            </span>
          </label>

          <label className="block text-sm">
            <span className="font-medium">
              Helper model (prompt ideas, optional)
            </span>
            <select
              value={s.helperModel ?? ""}
              onChange={(e) => save({ helperModel: e.target.value || null })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            >
              <option value="">None</option>
              {(models?.chat ?? []).slice(0, 80).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.promptPrice != null
                    ? ` — $${(m.promptPrice * 1e6).toFixed(2)}/M in`
                    : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Cheapest vision-capable chat models first. Used by “Suggest
              poses/animations”.
            </span>
          </label>

          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="font-medium">Concurrency</span>
              <input
                type="number"
                min={1}
                max={6}
                value={s.concurrency}
                onChange={(e) => save({ concurrency: Number(e.target.value) })}
                className="w-16 rounded border border-slate-300 px-2 py-1"
              />
              <span className="text-xs text-slate-500">requests at a time</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={state.mock}
                disabled={state.mockForcedByEnv}
                onChange={(e) => save({ mock: e.target.checked })}
                className="mt-1"
              />
              <span>
                Mock mode — test everything for free (no provider calls)
                {state.mockForcedByEnv && (
                  <span className="block text-xs text-slate-500">
                    Forced by MOCK_MODE=1
                  </span>
                )}
              </span>
            </label>
          </div>
        </div>

        <section className="mt-5 border-t pt-3 text-sm">
          <div className="font-medium">Project “{state.project.name}”</div>
          <Btn
            kind="danger"
            className="mt-2"
            disabled={state.projects.length <= 1}
            onClick={async () => {
              if (
                !confirm(
                  `Delete the project “${state.project.name}” and ALL its images and clips from disk?`,
                )
              )
                return;
              try {
                await api(`/api/projects/${state.project.id}`, {
                  method: "DELETE",
                });
                refresh();
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Delete this project…
          </Btn>
        </section>
        {err && (
          <p className="mt-3 rounded bg-rose-50 p-2 text-sm text-rose-700">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}
