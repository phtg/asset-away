"use client";

import { useState } from "react";
import {
  estimateVideoCost,
  nearestDuration,
  defaultResolution,
  supportsFirstFrame,
} from "@/lib/models";
import { money, patch, post, type ModelLists, type ServerState } from "./api";

export function ProviderPanel({
  state,
  models,
  modelsError,
  refresh,
}: {
  state: ServerState;
  models: ModelLists | null;
  modelsError: string | null;
  refresh: () => void;
}) {
  const s = state.settings;
  const [key, setKey] = useState("");
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

  const videoModels = (models?.video ?? []).filter(supportsFirstFrame);
  const priced = videoModels.map((m) => {
    const cost = estimateVideoCost(m, {
      duration: nearestDuration(m.supportedDurations),
      resolution: defaultResolution(m.supportedResolutions),
      audio: false,
    });
    return { m, cost };
  });
  priced.sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99));
  const imageModels = (models?.image ?? []).filter((m) => m.acceptsImageInput);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">1. Provider</h2>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-800">
          Video: OpenRouter (supported)
        </span>
        <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-800">
          Stills &amp; helpers: OpenRouter
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
          fal.ai: not used
        </span>
      </div>

      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="font-medium">
          OpenRouter API key:{" "}
          {state.keySource === "env" && (
            <span className="text-emerald-700">set via environment</span>
          )}
          {state.keySource === "session" && (
            <span className="text-emerald-700">
              session only (server memory)
            </span>
          )}
          {state.keySource === "none" && (
            <span className="text-rose-700">missing</span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-600">
          An API key is separate from any chat subscription (Claude, ChatGPT…).
          Create one at openrouter.ai/keys and add credits. Prefer putting it in{" "}
          <code>.env.local</code>. A session key lives only in this
          server&apos;s memory — never in the browser, a URL, or a saved file.
        </p>
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
            placeholder="sk-or-… (session only)"
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">
            Use
          </button>
          {state.keySource === "session" && (
            <button
              type="button"
              onClick={() => saveKey(null)}
              className="rounded border px-3 py-1 text-sm"
            >
              Forget
            </button>
          )}
        </form>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Video model (image → video)</span>
          <select
            value={s.videoModel ?? ""}
            onChange={(e) => save({ videoModel: e.target.value || null })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="">Choose…</option>
            {priced.map(({ m, cost }) => (
              <option key={m.id} value={m.id}>
                {m.id} —{" "}
                {cost == null
                  ? "cost unavailable"
                  : `~${money(cost)} / default clip`}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            Live list from OpenRouter; only models that accept a starting frame.
            Estimates use published per-second prices; actual cost is shown
            after each job.
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium">
            Image model (prepare starting images, optional)
          </span>
          <select
            value={s.stillModel ?? ""}
            onChange={(e) => save({ stillModel: e.target.value || null })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="">None</option>
            {imageModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            Cost is reported after generation.
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium">
            Helper model (prompt tools, optional)
          </span>
          <select
            value={s.helperModel ?? ""}
            onChange={(e) => save({ helperModel: e.target.value || null })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
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
            Cheapest vision-capable chat models first.
          </span>
        </label>

        <div className="space-y-2 text-sm">
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
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={s.autoApproveStills}
              onChange={(e) => save({ autoApproveStills: e.target.checked })}
              className="mt-1"
            />
            <span>
              Skip still review and chain the paid video automatically
              <span className="block text-xs text-amber-700">
                Off by default. Spends money without a review step.
              </span>
            </span>
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
              Mock mode (test the queue and UI; no real provider calls, no cost)
              {state.mockForcedByEnv && (
                <span className="block text-xs text-slate-500">
                  Forced by MOCK_MODE=1
                </span>
              )}
            </span>
          </label>
        </div>
      </div>

      {(modelsError || err) && (
        <p className="mt-2 rounded bg-rose-50 p-2 text-sm text-rose-700">
          {modelsError ?? err}
        </p>
      )}
    </section>
  );
}
