"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultResolution,
  estimateVideoCost,
  nearestDuration,
  supportsFirstFrame,
} from "@/lib/models";
import type { ProjectKind } from "@/lib/types";
import { AnimationsTab } from "./AnimationsTab";
import { ImagesTab } from "./ImagesTab";
import { LibraryTab } from "./LibraryTab";
import { Lightbox } from "./Lightbox";
import { RunDialog } from "./RunDialog";
import { SettingsDialog } from "./SettingsDialog";
import { StyleTab } from "./StyleTab";
import { Btn } from "./ui";
import {
  api,
  patch,
  post,
  type ModelLists,
  type ServerState,
  type Tab,
} from "./api";

const TABS: { id: Tab; label: string; hint: string }[] = [
  {
    id: "style",
    label: "1 · Style",
    hint: "Describe the look, add references",
  },
  { id: "images", label: "2 · Images", hint: "Plan, generate, review" },
  {
    id: "animations",
    label: "3 · Animations",
    hint: "Animate approved images",
  },
  {
    id: "library",
    label: "4 · Library & Export",
    hint: "Everything, ready to download",
  },
];

export function Workspace() {
  const [state, setState] = useState<ServerState | null>(null);
  const [models, setModels] = useState<ModelLists | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("style");
  const [lightbox, setLightbox] = useState<{
    id: string;
    list: string[];
  } | null>(null);
  const [runIds, setRunIds] = useState<string[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProject, setNewProject] = useState(false);

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

  // remember the tab (best effort: storage can be unavailable)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("asset-away-tab") as Tab | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {}
  }, []);
  const go = useCallback((t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem("asset-away-tab", t);
    } catch {}
  }, []);

  const mock = state?.mock;
  useEffect(() => {
    if (mock === undefined) return;
    setModels(null);
    setModelsError(null);
    api<ModelLists>("/api/models")
      .then(setModels)
      .catch((e) => setModelsError(e.message));
  }, [mock]);

  // Sensible defaults from the live model lists (only when nothing valid is chosen).
  useEffect(() => {
    if (!state || !models) return;
    const s = state.settings;
    const upd: Record<string, string> = {};
    const usable = models.video.filter(supportsFirstFrame);
    if (usable.length && !usable.some((m) => m.id === s.videoModel)) {
      const cost = (m: (typeof usable)[number]) =>
        estimateVideoCost(m, {
          duration: nearestDuration(m.supportedDurations),
          resolution: defaultResolution(m.supportedResolutions),
          audio: false,
        }) ?? 99;
      upd.videoModel = [...usable].sort((a, b) => cost(a) - cost(b))[0].id;
    }
    const imgs = models.image.filter(
      (m) => m.acceptsImageInput && m.maxReferences > 0,
    );
    if (imgs.length && !imgs.some((m) => m.id === s.imageModel)) {
      upd.imageModel = (imgs.find((m) => m.transparent) ?? imgs[0]).id;
    }
    if (Object.keys(upd).length) void patch("/api/settings", upd).then(refresh);
  }, [state, models, refresh]);

  const review = useCallback(
    (id: string, list: string[]) => setLightbox({ id, list }),
    [],
  );
  const tabProps = useMemo(
    () =>
      state
        ? { state, models, refresh, review, run: setRunIds, goto: go }
        : null,
    [state, models, refresh, review, go],
  );

  if (!state || !tabProps)
    return <main className="p-6 text-slate-500">Loading…</main>;
  const running = state.items.filter((i) =>
    ["queued", "submitting", "generating", "downloading"].includes(i.state),
  ).length;
  const needsKey = state.keySource === "none" && !state.mock;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2">
          <h1 className="text-lg font-bold tracking-tight">Asset Away</h1>
          <select
            value={state.project.id}
            onChange={async (e) => {
              if (e.target.value === "__new") return setNewProject(true);
              await patch("/api/settings", { activeProjectId: e.target.value });
              refresh();
            }}
            className="max-w-[14rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium"
            aria-label="Project"
          >
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.count})
              </option>
            ))}
            <option value="__new">+ New project…</option>
          </select>
          <nav className="flex flex-1 flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                title={t.hint}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {running > 0 && (
            <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800">
              {running} running
            </span>
          )}
          <Btn kind="ghost" onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </Btn>
        </div>
        {state.mock && (
          <div className="bg-amber-100 px-4 py-1.5 text-center text-sm font-semibold text-amber-900">
            MOCK MODE — nothing is sent to any provider and nothing is billed.
            Results are placeholder art.
          </div>
        )}
        {needsKey && (
          <div className="bg-rose-50 px-4 py-1.5 text-center text-sm text-rose-800">
            No OpenRouter API key yet.{" "}
            <button
              className="font-semibold underline"
              onClick={() => setSettingsOpen(true)}
            >
              Add it in Settings
            </button>{" "}
            (or turn on Mock mode to try the app for free).
          </div>
        )}
        {!state.ffmpeg.available && (
          <div className="bg-amber-50 px-4 py-1.5 text-center text-sm text-amber-900">
            ffmpeg not found — needed for transparent GIF/WebM and background
            colours. Install with <code>brew install ffmpeg</code>, then
            restart.
          </div>
        )}
        {modelsError && (
          <div className="bg-rose-50 px-4 py-1.5 text-center text-sm text-rose-800">
            {modelsError}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl p-4">
        {tab === "style" && <StyleTab {...tabProps} />}
        {tab === "images" && <ImagesTab {...tabProps} />}
        {tab === "animations" && <AnimationsTab {...tabProps} />}
        {tab === "library" && <LibraryTab {...tabProps} />}
      </main>

      {lightbox && (
        <Lightbox
          state={state}
          start={lightbox}
          refresh={refresh}
          run={(ids) => {
            setLightbox(null);
            setRunIds(ids);
          }}
          onClose={() => setLightbox(null)}
        />
      )}
      {runIds && (
        <RunDialog
          ids={runIds}
          mock={state.mock}
          onClose={() => setRunIds(null)}
          onStarted={refresh}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          state={state}
          models={models}
          refresh={refresh}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {newProject && (
        <NewProjectDialog
          onClose={() => setNewProject(false)}
          onCreated={() => {
            setNewProject(false);
            go("style");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProjectKind>("mascot");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post("/api/projects", { name, kind });
            onCreated();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <h3 className="text-lg font-semibold">New project</h3>
        <p className="mt-1 text-xs text-slate-500">
          A project is one style: a mascot, an icon set, an illustration style…
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Coco the robot"
          className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ProjectKind)}
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2"
        >
          <option value="mascot">Mascot / character</option>
          <option value="icon">Icon set</option>
          <option value="illustration">Illustration style</option>
          <option value="other">Other</option>
        </select>
        {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" disabled={!name.trim()}>
            Create
          </Btn>
        </div>
      </form>
    </div>
  );
}
