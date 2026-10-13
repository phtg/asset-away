"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultResolution,
  estimateVideoCost,
  nearestDuration,
  supportsFirstFrame,
} from "@/lib/models";
import { ACTIVE_STATES } from "@/lib/types";
import { api, patch, post, type ModelLists, type ServerState } from "./api";
import { Gallery } from "./Gallery";
import { JobCard } from "./JobCard";
import { PromptsPanel } from "./PromptsPanel";
import { ProviderPanel } from "./ProviderPanel";
import { RunDialog } from "./RunDialog";

export function Workspace() {
  const [state, setState] = useState<ServerState | null>(null);
  const [models, setModels] = useState<ModelLists | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [dialogIds, setDialogIds] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api<ServerState>("/api/state")
      .then(setState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const mock = state?.mock;
  useEffect(() => {
    if (mock === undefined) return;
    setModels(null);
    setModelsError(null);
    api<ModelLists>("/api/models")
      .then(setModels)
      .catch((e) => setModelsError(e.message));
  }, [mock]);

  // Sensible default: the cheapest priced video model that takes a start frame.
  useEffect(() => {
    if (!state || !models) return;
    const usable = models.video.filter(supportsFirstFrame);
    if (
      !usable.length ||
      usable.some((m) => m.id === state.settings.videoModel)
    )
      return;
    const cost = (m: (typeof usable)[number]) =>
      estimateVideoCost(m, {
        duration: nearestDuration(m.supportedDurations),
        resolution: defaultResolution(m.supportedResolutions),
        audio: false,
      }) ?? 99;
    const best = [...usable].sort((a, b) => cost(a) - cost(b))[0];
    void patch("/api/settings", { videoModel: best.id }).then(refresh);
  }, [state, models, refresh]);

  const model = useMemo(
    () => models?.video.find((m) => m.id === state?.settings.videoModel),
    [models, state?.settings.videoModel],
  );

  if (!state) return <main className="p-6 text-slate-500">Loading…</main>;

  const { jobs, images, settings } = state;
  const sorted = [...jobs].sort((a, b) => a.order - b.order);
  const draftIncluded = sorted.filter((j) => j.include && j.state === "draft");
  const queued = jobs.filter((j) => j.state === "queued").length;
  const active = jobs.filter((j) => ACTIVE_STATES.includes(j.state)).length;
  const completed = jobs.filter((j) => j.state === "completed").length;

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">Asset Away</h1>
        <p className="text-sm text-slate-600">
          Batch-generate short character animations for presentations.
          Everything runs locally; only provider calls leave this machine.
        </p>
        {state.mock && (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-100 p-2 text-sm font-semibold text-amber-900">
            MOCK MODE — no real provider is contacted and nothing is billed.
            Outputs are a placeholder test clip, not your character.
          </div>
        )}
      </header>

      <ProviderPanel
        state={state}
        models={models}
        modelsError={modelsError}
        refresh={refresh}
      />
      <Gallery
        images={images}
        defaultImageId={settings.defaultImageId}
        maxUploadMb={state.maxUploadMb}
        refresh={refresh}
      />
      <PromptsPanel
        shared={settings.sharedInstructions}
        images={images}
        jobs={sorted}
        helperReady={!!settings.helperModel}
        refresh={refresh}
      />

      <section>
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
          <h2 className="mr-auto text-lg font-semibold">
            4. Jobs{" "}
            <span className="text-sm font-normal text-slate-500">
              ({jobs.length} · {active} running · {queued} queued · {completed}{" "}
              done)
            </span>
          </h2>
          <button
            onClick={() => setDialogIds(draftIncluded.map((j) => j.id))}
            disabled={!draftIncluded.length}
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Generate selected ({draftIncluded.length})
          </button>
          <button
            onClick={async () => {
              if (
                confirm(
                  "Return queued jobs to draft?\n\nJobs already submitted to the provider cannot be cancelled and will keep running (and billing).",
                )
              ) {
                const r = await post<{ stopped: number; note: string }>(
                  "/api/jobs/stop",
                );
                setNote(
                  `${r.stopped} queued job(s) returned to draft. ${r.note}`,
                );
                refresh();
              }
            }}
            disabled={!queued}
            className="rounded border px-3 py-2 text-sm disabled:opacity-40"
          >
            Stop queued
          </button>
          <a
            href="/api/download-all"
            aria-disabled={!completed}
            className={`rounded border px-3 py-2 text-sm ${completed ? "" : "pointer-events-none opacity-40"}`}
          >
            Download all (ZIP)
          </a>
        </div>
        {note && <p className="mt-2 text-sm text-slate-600">{note}</p>}

        <div className="mt-3 space-y-3">
          {sorted.length === 0 && (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
              No jobs yet. Paste prompts above and parse them into job cards.
            </p>
          )}
          {sorted.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              images={images}
              defaultImageId={settings.defaultImageId}
              shared={settings.sharedInstructions}
              model={model}
              helperReady={!!settings.helperModel}
              mock={state.mock}
              refresh={refresh}
            />
          ))}
        </div>
      </section>

      <footer className="pb-8 text-xs text-slate-500">
        Notes: backgrounds are not guaranteed to be transparent and clips are
        not guaranteed to loop seamlessly. Videos are saved to{" "}
        <code>data/outputs</code>.
      </footer>

      {dialogIds && (
        <RunDialog
          ids={dialogIds}
          mock={state.mock}
          onClose={() => setDialogIds(null)}
          onStarted={refresh}
        />
      )}
    </main>
  );
}
