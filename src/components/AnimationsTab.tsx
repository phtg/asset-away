"use client";

import { useEffect, useState } from "react";
import {
  estimateVideoCost,
  resolveSettings,
  supportsLastFrame,
} from "@/lib/models";
import type { Item, VideoModel } from "@/lib/types";
import { isBusy, keptImages } from "./helpers";
import { Btn, StateBadge, Thumb, elapsed } from "./ui";
import { api, money, patch, post, type TabProps } from "./api";

export function AnimationsTab({
  state,
  models,
  refresh,
  review,
  run,
  goto,
}: TabProps) {
  const sources = keptImages(state.items);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = sources.find((s) => s.id === focusId) ?? sources[0];
  const vModel = models?.video.find((m) => m.id === state.settings.videoModel);
  const clips = state.items.filter((i) => i.kind === "clip");
  const drafts = clips.filter(
    (i) => i.state === "draft" && i.include && i.sourceId,
  );
  const queued = clips.filter((i) => i.state === "queued").length;

  if (!sources.length) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-500">
        Nothing to animate yet. Keep at least one image in the{" "}
        <button
          className="font-semibold underline"
          onClick={() => goto("images")}
        >
          Images tab
        </button>{" "}
        (or upload a reference on the{" "}
        <button
          className="font-semibold underline"
          onClick={() => goto("style")}
        >
          Style tab
        </button>{" "}
        — uploads count as kept).
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
      <aside className="space-y-2 lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-auto">
        <h2 className="text-lg font-semibold">Images</h2>
        {sources.map((s) => {
          const n = clips.filter((c) => c.sourceId === s.id);
          const done = n.filter(
            (c) => c.state === "completed" && c.verdict !== "rejected",
          ).length;
          const pend = n.filter((c) => c.state === "draft").length;
          const plateOk = state.items.some((i) => i.id === s.plateId);
          return (
            <button
              key={s.id}
              onClick={() => setFocusId(s.id)}
              className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${focus?.id === s.id ? "border-slate-900 bg-white shadow-sm" : "border-slate-200 bg-white/60 hover:bg-white"}`}
            >
              <Thumb item={s} className="h-12 w-12 shrink-0" />
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-slate-500">
                  {done} clip{done === 1 ? "" : "s"}
                  {pend ? ` · ${pend} draft` : ""}
                  {state.project.greenScreen
                    ? plateOk
                      ? " · green ✓"
                      : " · no green"
                    : ""}
                </span>
              </span>
            </button>
          );
        })}
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="sticky top-[3.1rem] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
          <h2 className="mr-auto text-lg font-semibold">Animations</h2>
          {queued > 0 && (
            <Btn
              onClick={async () => {
                if (
                  confirm(
                    "Return queued clips to draft?\n\nClips already submitted to the provider cannot be cancelled and keep billing.",
                  )
                ) {
                  await post("/api/run/stop");
                  refresh();
                }
              }}
            >
              Stop queued ({queued})
            </Btn>
          )}
          <Btn
            kind="success"
            disabled={!drafts.length}
            onClick={() => run(drafts.map((i) => i.id))}
          >
            Generate all selected ({drafts.length})
          </Btn>
        </div>
        {focus && (
          <ImagePanel
            key={focus.id}
            src={focus}
            {...{ state, vModel, refresh, review, run }}
          />
        )}
      </div>
    </div>
  );
}

function ImagePanel({
  src,
  state,
  vModel,
  refresh,
  review,
  run,
}: {
  src: Item;
  state: TabProps["state"];
  vModel: VideoModel | undefined;
  refresh: () => void;
  review: TabProps["review"];
  run: TabProps["run"];
}) {
  const project = state.project;
  const items = state.items;
  const [count, setCount] = useState(3);
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const plate = items.find((i) => i.id === src.plateId);
  const pendingPlate = items.find(
    (i) =>
      i.origin === "plate" &&
      i.parentId === src.id &&
      i.id !== src.plateId &&
      i.verdict !== "rejected",
  );
  const mine = items.filter((i) => i.kind === "clip" && i.sourceId === src.id);
  const open = mine
    .filter((i) => i.state !== "completed")
    .sort((a, b) => a.order - b.order);
  const results = mine
    .filter((i) => i.state === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const shown = showAll ? results : results.slice(0, 8);
  const selected = open.filter((i) => i.state === "draft" && i.include);

  const prepare = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ plate: Item; free: boolean }>(
        `/api/items/${src.id}/plate`,
      );
      refresh();
      if (!r.free) run([r.plate.id]);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{
        ideas: {
          name: string;
          prompt: string;
          duration: number | null;
          aspectRatio: string | null;
          loop: boolean | null;
          reason: string;
        }[];
      }>("/api/helpers", {
        kind: "animations",
        itemId: src.id,
        count,
        theme,
      });
      await post("/api/items/bulk", {
        projectId: project.id,
        kind: "clip",
        label: `${src.name} · ideas`,
        items: r.ideas.map((i) => ({
          name: i.name,
          prompt: i.prompt,
          sourceId: src.id,
          loop: i.loop === true,
          suggestion: {
            duration: i.duration,
            aspectRatio: i.aspectRatio,
            loop: i.loop,
            reason: i.reason,
          },
        })),
      });
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-4">
        <button onClick={() => review(src.id, [src.id])} title="View large">
          <Thumb item={src} className="h-32 w-32" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-lg font-semibold">{src.name}</h3>

          {project.greenScreen ? (
            <div className="rounded-lg bg-slate-50 p-2 text-sm">
              <div className="font-medium">Green screen</div>
              {plate ? (
                <div className="mt-1 flex items-center gap-2 text-emerald-700">
                  <Thumb
                    item={plate}
                    className="h-10 w-10"
                    bg={project.keyColor}
                  />{" "}
                  Ready ✓ — clips start from this green-screen version.
                </div>
              ) : pendingPlate ? (
                <PlateStatus
                  plate={pendingPlate}
                  refresh={refresh}
                  review={review}
                  run={run}
                />
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Btn onClick={prepare} disabled={busy}>
                    Prepare green screen
                  </Btn>
                  <span className="text-xs text-slate-500">
                    {src.file?.hasAlpha
                      ? "Free: this image is transparent, so it's done locally (needs ffmpeg)."
                      : "One image-model call that swaps the background for green; you review it before use."}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Green screen is off for this project: clips use this image as-is
              and keep its background.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="number"
              min={1}
              max={8}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-14 rounded border border-slate-300 px-2 py-1"
            />
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Direction (optional), e.g. subtle idle motions for a title slide"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
            />
            <Btn
              onClick={suggest}
              disabled={busy || !state.settings.helperModel}
              title={
                state.settings.helperModel
                  ? "One paid chat call using this image"
                  : "Choose a helper model in Settings"
              }
            >
              {busy ? "Thinking…" : "✨ Suggest animations"}
            </Btn>
            <Btn
              onClick={async () => {
                await post("/api/items/bulk", {
                  projectId: project.id,
                  kind: "clip",
                  label: `${src.name} · manual`,
                  items: [
                    { name: "New animation", prompt: "", sourceId: src.id },
                  ],
                });
                refresh();
              }}
            >
              + Add one
            </Btn>
          </div>
          <p className="text-xs text-slate-500">
            Suggestions also pick a duration, aspect ratio and loop/no-loop that
            fit each motion. You can change any of them.
          </p>
          {msg && (
            <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">
              {msg}
            </p>
          )}
        </div>
      </div>

      {open.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">To generate</h4>
            <Btn
              kind="success"
              disabled={!selected.length}
              onClick={() => run(selected.map((i) => i.id))}
            >
              Generate {selected.length} for this image
            </Btn>
          </div>
          {open.map((c) => (
            <ClipRow key={c.id} item={c} model={vModel} refresh={refresh} />
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">Results ({results.length})</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((c) => (
              <button
                key={c.id}
                onClick={() =>
                  review(
                    c.id,
                    results.map((r) => r.id),
                  )
                }
                className={`group relative rounded-lg border p-2 text-left ${c.verdict === "rejected" ? "opacity-50" : c.verdict === "kept" ? "border-emerald-300" : "border-slate-200"}`}
              >
                <div className="relative">
                  <Thumb
                    item={plate ?? src}
                    className="aspect-video w-full"
                    bg={plate ? project.keyColor : null}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow group-hover:scale-110">
                    ▶
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <StateBadge item={c} />
                </div>
                <div className="text-xs text-slate-500">
                  {c.run
                    ? `${c.run.duration}s · ${c.run.aspectRatio ?? "auto"}${c.loop ? " · loop" : ""}`
                    : ""}
                </div>
              </button>
            ))}
          </div>
          {results.length > 8 && !showAll && (
            <button
              className="mt-2 text-sm text-sky-700 underline"
              onClick={() => setShowAll(true)}
            >
              Show {results.length - 8} earlier
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PlateStatus({
  plate,
  refresh,
  review,
  run,
}: {
  plate: Item;
  refresh: () => void;
  review: TabProps["review"];
  run: TabProps["run"];
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      {plate.state === "completed" ? (
        <>
          <button onClick={() => review(plate.id, [plate.id])}>
            <Thumb item={plate} className="h-14 w-14" />
          </button>
          <span>Review the green-screen version:</span>
          <Btn
            kind="success"
            className="!px-2 !py-1 !text-xs"
            onClick={() =>
              void post(`/api/items/${plate.id}/verdict`, {
                verdict: "kept",
              }).then(refresh)
            }
          >
            ✓ Keep
          </Btn>
          <Btn
            kind="danger"
            className="!px-2 !py-1 !text-xs"
            onClick={() =>
              void post(`/api/items/${plate.id}/verdict`, {
                verdict: "rejected",
              }).then(refresh)
            }
          >
            ✗ Reject
          </Btn>
        </>
      ) : plate.state === "draft" ? (
        <Btn onClick={() => run([plate.id])}>Generate green screen…</Btn>
      ) : plate.state === "failed" ? (
        <>
          <span className="text-rose-700">{plate.error}</span>
          <Btn
            kind="danger"
            className="!px-2 !py-1 !text-xs"
            onClick={() =>
              confirm("Retry? It may be charged again.") &&
              void post(`/api/items/${plate.id}/retry`, { confirm: true }).then(
                refresh,
              )
            }
          >
            Retry…
          </Btn>
          <Btn
            className="!px-2 !py-1 !text-xs"
            onClick={() =>
              void api(`/api/items/${plate.id}`, { method: "DELETE" }).then(
                refresh,
              )
            }
          >
            Discard
          </Btn>
        </>
      ) : (
        <span className="text-slate-600">
          {plate.state === "submission_uncertain"
            ? "Uncertain: check the item in the Library."
            : "Generating the green-screen version…"}
        </span>
      )}
    </div>
  );
}

function ClipRow({
  item,
  model,
  refresh,
}: {
  item: Item;
  model: VideoModel | undefined;
  refresh: () => void;
}) {
  const [prompt, setPrompt] = useState(item.prompt);
  const [name, setName] = useState(item.name);
  const [seed, setSeed] = useState(item.seed == null ? "" : String(item.seed));
  const editable = item.state === "draft" || item.state === "failed";
  useEffect(() => {
    setPrompt((p) => (p === item.prompt ? p : item.prompt));
  }, [item.prompt]);
  const save = (b: Record<string, unknown>) =>
    patch(`/api/items/${item.id}`, b)
      .then(refresh)
      .catch(() => {});
  const r = model ? resolveSettings(item, model) : null;
  const cost =
    model && r
      ? estimateVideoCost(model, {
          duration: r.duration,
          resolution: r.resolution,
          audio: r.generateAudio === true,
        })
      : null;
  const sug = item.suggestion;
  const star = (on: boolean) => (on ? " ✨" : "");

  return (
    <div
      className={`rounded-lg border p-3 ${item.include || !editable ? "border-slate-200" : "border-slate-100 opacity-60"}`}
    >
      <div className="flex items-center gap-2">
        {item.state === "draft" && (
          <input
            type="checkbox"
            checked={item.include}
            onChange={(e) => void save({ include: e.target.checked })}
            aria-label="Include"
          />
        )}
        <input
          value={name}
          disabled={!editable}
          onChange={(e) => setName(e.target.value)}
          onBlur={() =>
            name.trim() && name !== item.name && void save({ name })
          }
          className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 font-semibold hover:border-slate-300 disabled:bg-transparent"
          aria-label="Animation name"
        />
        <StateBadge item={item} />
        {item.state === "draft" && (
          <button
            className="text-xs text-rose-600 hover:underline"
            onClick={() =>
              void api(`/api/items/${item.id}`, { method: "DELETE" }).then(
                refresh,
              )
            }
          >
            Delete
          </button>
        )}
      </div>
      <textarea
        value={prompt}
        rows={2}
        disabled={!editable}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => prompt !== item.prompt && void save({ prompt })}
        placeholder="Describe the motion…"
        className="mt-2 w-full rounded border border-slate-300 p-2 text-sm disabled:bg-slate-50"
      />

      {editable && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <label>
            Duration
            <select
              value={item.duration ?? ""}
              onChange={(e) =>
                void save({
                  duration: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
            >
              <option value="">
                Auto · {r?.duration ?? "?"}s{star(!!sug?.duration)}
              </option>
              {(model?.supportedDurations ?? []).map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </label>
          <label>
            Aspect ratio
            <select
              value={item.aspectRatio ?? ""}
              onChange={(e) =>
                void save({ aspectRatio: e.target.value || null })
              }
              disabled={!model?.supportedAspectRatios}
              className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
            >
              <option value="">
                Auto · {r?.aspectRatio ?? "as image"}
                {star(!!sug?.aspectRatio && !!r?.aspectRatio)}
              </option>
              {(model?.supportedAspectRatios ?? []).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            Resolution
            <select
              value={item.resolution ?? ""}
              onChange={(e) =>
                void save({ resolution: e.target.value || null })
              }
              className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
            >
              <option value="">Default · {r?.resolution ?? "?"}</option>
              {(model?.supportedResolutions ?? []).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            Loop{star(sug?.loop != null)}
            <span className="mt-1 flex items-center gap-1">
              <input
                type="checkbox"
                checked={item.loop}
                onChange={(e) => void save({ loop: e.target.checked })}
              />
              {item.loop
                ? model
                  ? supportsLastFrame(model)
                    ? "seamless (first=last)"
                    : "best effort"
                  : ""
                : "plays once"}
            </span>
          </label>
          {model?.seed === true && (
            <label>
              Seed
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onBlur={() =>
                  void save({ seed: seed === "" ? null : Number(seed) })
                }
                type="number"
                className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
              />
            </label>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {sug?.reason && <span>✨ {sug.reason}</span>}
        {editable && <span>Est. cost: {money(cost)}</span>}
        {isBusy(item) && (
          <span>
            {item.state === "queued"
              ? "Waiting for a slot…"
              : `${item.providerStatus ?? "working"} · ${elapsed(item.submittedAt)}`}
          </span>
        )}
      </div>
      {isBusy(item) && item.state === "generating" && (
        <p className="mt-1 text-xs text-slate-500">
          Submitted clips can&apos;t be cancelled; polling resumes after a
          restart.
        </p>
      )}
      {item.pollError && (
        <p className="mt-1 rounded bg-amber-50 p-1.5 text-xs text-amber-800">
          Trouble checking status (still retrying): {item.pollError}
        </p>
      )}
      {item.state === "failed" && (
        <div className="mt-2 rounded bg-rose-50 p-2 text-sm text-rose-900">
          {item.error}
          <div className="mt-1">
            <Btn
              kind="danger"
              className="!px-2 !py-0.5 !text-xs"
              onClick={() => {
                const free =
                  item.providerJobId && item.providerStatus === "completed";
                if (
                  free ||
                  confirm("Retry this clip? A new generation may be charged.")
                )
                  void post(`/api/items/${item.id}/retry`, { confirm: true })
                    .then(refresh)
                    .catch((e) => alert(e.message));
              }}
            >
              {item.providerJobId && item.providerStatus === "completed"
                ? "Retry download (free)"
                : "Retry…"}
            </Btn>
          </div>
        </div>
      )}
      {item.state === "submission_uncertain" && (
        <div className="mt-2 rounded border border-orange-300 bg-orange-50 p-2 text-sm text-orange-900">
          <b>Submission uncertain.</b> {item.error}
          <p className="mt-1 text-xs">
            Check your OpenRouter activity page for a video around{" "}
            {item.submittedAt
              ? new Date(item.submittedAt).toLocaleTimeString()
              : "this time"}
            . This app will not resubmit on its own.
          </p>
          <Btn
            className="mt-1 !px-2 !py-0.5 !text-xs"
            onClick={() =>
              confirm(
                "Only continue if you checked and nothing was submitted. A retry may be charged again if the first attempt did go through.",
              ) &&
              void post(`/api/items/${item.id}/clear-uncertain`, {
                confirm: true,
              }).then(refresh)
            }
          >
            I checked — it was not submitted
          </Btn>
        </div>
      )}
    </div>
  );
}
