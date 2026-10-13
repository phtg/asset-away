"use client";

import { useEffect, useRef, useState } from "react";
import {
  defaultResolution,
  estimateVideoCost,
  nearestDuration,
  resolveSettings,
  validateSettings,
} from "@/lib/models";
import { composePrompt } from "@/lib/parse";
import type { ImageRecord, Job, JobState, VideoModel } from "@/lib/types";
import { api, money, patch, post } from "./api";

const LABEL: Record<JobState, string> = {
  draft: "Draft",
  queued: "Queued",
  preparing_image: "Preparing image",
  awaiting_image_approval: "Awaiting image approval",
  submitting: "Submitting",
  generating: "Generating",
  downloading: "Downloading",
  completed: "Completed",
  failed: "Failed",
  submission_uncertain: "Submission uncertain",
};
const COLOR: Record<JobState, string> = {
  draft: "bg-slate-100 text-slate-700",
  queued: "bg-slate-200 text-slate-800",
  preparing_image: "bg-sky-100 text-sky-800",
  awaiting_image_approval: "bg-amber-100 text-amber-800",
  submitting: "bg-sky-100 text-sky-800",
  generating: "bg-sky-100 text-sky-800",
  downloading: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  submission_uncertain: "bg-orange-100 text-orange-800",
};
const PROGRESS: Partial<Record<JobState, number>> = {
  queued: 8,
  preparing_image: 20,
  awaiting_image_approval: 35,
  submitting: 45,
  generating: 65,
  downloading: 92,
  completed: 100,
};
const EDITABLE: JobState[] = ["draft", "failed"];
const DELETABLE: JobState[] = [
  "draft",
  "failed",
  "completed",
  "awaiting_image_approval",
  "submission_uncertain",
];

function elapsed(from: string | null): string {
  if (!from) return "";
  const s = Math.max(
    0,
    Math.round((Date.now() - new Date(from).getTime()) / 1000),
  );
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function JobCard({
  job,
  images,
  defaultImageId,
  shared,
  model,
  helperReady,
  mock,
  refresh,
}: {
  job: Job;
  images: ImageRecord[];
  defaultImageId: string | null;
  shared: string;
  model: VideoModel | undefined;
  helperReady: boolean;
  mock: boolean;
  refresh: () => void;
}) {
  const editable = EDITABLE.includes(job.state);
  const [action, setAction] = useState(job.actionPrompt);
  const [still, setStill] = useState(job.stillPrompt);
  const [name, setName] = useState(job.name);
  const editing = useRef(false);
  const [suggestion, setSuggestion] = useState<{
    kind: "refine" | "still";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editing.current) {
      setAction(job.actionPrompt);
      setStill(job.stillPrompt);
      setName(job.name);
    }
  }, [job.actionPrompt, job.stillPrompt, job.name]);

  const save = (p: Record<string, unknown>) =>
    patch(`/api/jobs/${job.id}`, p)
      .then(refresh)
      .catch((e) => setErr(e.message));
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const startImg = images.find(
    (i) => i.id === (job.startImageId ?? defaultImageId),
  );
  const resolved = model ? resolveSettings(job, model) : null;
  const problems = model ? validateSettings(job, model) : [];
  const cost =
    model && resolved
      ? estimateVideoCost(model, {
          duration: resolved.duration,
          resolution: resolved.resolution,
          audio: resolved.generateAudio === true,
        })
      : null;
  const fullPrompt = composePrompt(shared, action);
  const progress = PROGRESS[job.state];

  const helper = (kind: "refine" | "still") =>
    act(kind, async () => {
      const r = await post<{ text: string }>("/api/helpers", {
        kind,
        jobId: job.id,
      });
      setSuggestion({ kind, text: r.text });
    });

  const onFocus = () => (editing.current = true);
  const onBlurSave = (p: Record<string, unknown>) => {
    editing.current = false;
    void save(p);
  };

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm ${job.include ? "border-slate-200" : "border-slate-200 opacity-60"}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={job.include}
          onChange={(e) => void save({ include: e.target.checked })}
          title="Include in the next batch"
          aria-label="Include"
        />
        <input
          value={name}
          disabled={!editable}
          onFocus={onFocus}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onBlurSave({ name })}
          className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-base font-semibold hover:border-slate-300 disabled:bg-transparent"
          aria-label="Animation name"
        />
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[job.state]}`}
        >
          {LABEL[job.state]}
        </span>
        {DELETABLE.includes(job.state) && (
          <button
            onClick={() => {
              if (
                confirm(
                  `Delete "${job.name}"${job.output ? " and its saved video" : ""}?`,
                )
              )
                void act("delete", () =>
                  api(`/api/jobs/${job.id}`, { method: "DELETE" }),
                );
            }}
            className="text-xs text-rose-600 hover:underline"
          >
            Delete
          </button>
        )}
      </header>

      <div className="mt-3 grid gap-3 md:grid-cols-[120px_1fr]">
        <div>
          <div className="text-xs font-medium text-slate-500">
            Starting frame
          </div>
          {startImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/images/${startImg.id}/file`}
              alt={startImg.name}
              className="mt-1 aspect-square w-full rounded border bg-slate-100 object-contain"
            />
          ) : (
            <div className="mt-1 flex aspect-square items-center justify-center rounded border border-dashed text-xs text-slate-400">
              none
            </div>
          )}
          <select
            value={job.startImageId ?? ""}
            disabled={!editable}
            onChange={(e) =>
              void save({ startImageId: e.target.value || null })
            }
            className="mt-1 w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
          >
            <option value="">
              Default (
              {images.find((i) => i.id === defaultImageId)?.name ?? "none"})
            </option>
            {images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500">
              Motion prompt
            </label>
            <textarea
              value={action}
              rows={3}
              disabled={!editable}
              onFocus={onFocus}
              onChange={(e) => setAction(e.target.value)}
              onBlur={() => onBlurSave({ actionPrompt: action })}
              className="w-full rounded border border-slate-300 p-2 text-sm disabled:bg-slate-50"
            />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                disabled={!editable || !helperReady || !!busy || !action.trim()}
                onClick={() => void helper("refine")}
                title={
                  helperReady
                    ? "Paid OpenRouter chat call"
                    : "Choose a helper model in Provider"
                }
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                {busy === "refine"
                  ? "Refining…"
                  : "Refine for subtle 5s motion (paid helper)"}
              </button>
            </div>
          </div>

          <fieldset disabled={!editable} className="text-sm">
            <label className="mr-4 inline-flex items-center gap-1">
              <input
                type="radio"
                checked={job.mode === "animate"}
                onChange={() => void save({ mode: "animate" })}
              />
              Animate existing image
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={job.mode === "prepare"}
                onChange={() => void save({ mode: "prepare" })}
              />
              Prepare starting image first (you approve it)
            </label>
          </fieldset>

          {job.mode === "prepare" && (
            <div>
              <label className="text-xs font-medium text-slate-500">
                Starting-image preparation prompt (image model)
              </label>
              <textarea
                value={still}
                rows={2}
                disabled={!editable}
                onFocus={onFocus}
                onChange={(e) => setStill(e.target.value)}
                onBlur={() => onBlurSave({ stillPrompt: still })}
                placeholder="e.g. Same robot, holding a white coffee mug at chest height; everything else unchanged."
                className="w-full rounded border border-slate-300 p-2 text-sm disabled:bg-slate-50"
              />
              <button
                disabled={!editable || !helperReady || !!busy}
                onClick={() => void helper("still")}
                title={
                  helperReady
                    ? "Paid OpenRouter chat call using the starting image"
                    : "Choose a helper model in Provider"
                }
                className="rounded border px-2 py-1 text-xs disabled:opacity-40"
              >
                {busy === "still"
                  ? "Thinking…"
                  : "Suggest from reference (paid helper)"}
              </button>
            </div>
          )}

          {suggestion && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-sm">
              <div className="text-xs font-medium text-violet-800">
                Suggested{" "}
                {suggestion.kind === "refine"
                  ? "motion prompt"
                  : "starting-image prompt"}{" "}
                (not applied)
              </div>
              <p className="mt-1 whitespace-pre-wrap">{suggestion.text}</p>
              <div className="mt-1 flex gap-2 text-xs">
                <button
                  className="rounded bg-violet-700 px-2 py-1 text-white"
                  onClick={() => {
                    void save(
                      suggestion.kind === "refine"
                        ? { actionPrompt: suggestion.text }
                        : { stillPrompt: suggestion.text, mode: "prepare" },
                    );
                    setSuggestion(null);
                  }}
                >
                  Use this
                </button>
                <button
                  className="rounded border px-2 py-1"
                  onClick={() => setSuggestion(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <label>
              Duration
              <select
                disabled={!editable}
                value={job.duration ?? ""}
                onChange={(e) =>
                  void save({
                    duration: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
              >
                <option value="">
                  Default (
                  {model
                    ? (nearestDuration(model.supportedDurations) ?? "model")
                    : "—"}
                  s)
                </option>
                {(model?.supportedDurations ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </label>
            <label>
              Resolution
              <select
                disabled={!editable}
                value={job.resolution ?? ""}
                onChange={(e) =>
                  void save({ resolution: e.target.value || null })
                }
                className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
              >
                <option value="">
                  Default (
                  {model
                    ? (defaultResolution(model.supportedResolutions) ?? "model")
                    : "—"}
                  )
                </option>
                {(model?.supportedResolutions ?? []).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              Aspect ratio
              <select
                disabled={!editable || !model?.supportedAspectRatios}
                value={job.aspectRatio ?? ""}
                onChange={(e) =>
                  void save({ aspectRatio: e.target.value || null })
                }
                className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
              >
                <option value="">
                  {model?.supportedAspectRatios
                    ? "Auto (omit)"
                    : "Not supported"}
                </option>
                {(model?.supportedAspectRatios ?? []).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            {model?.seed === true && (
              <label>
                Seed
                <input
                  type="number"
                  disabled={!editable}
                  defaultValue={job.seed ?? ""}
                  onBlur={(e) =>
                    void save({
                      seed:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="mt-0.5 w-full rounded border border-slate-300 px-1 py-1"
                />
              </label>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Est. video cost: <b>{mock ? "$0 (mock)" : money(cost)}</b>
            {resolved?.generateAudio === false && " · audio off"}
          </div>
          {problems.map((p, i) => (
            <div key={i} className="text-xs text-amber-700">
              ⚠ {p}
            </div>
          ))}

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500">
              Complete prompts that will be submitted
            </summary>
            <div className="mt-1 text-slate-500">
              Video prompt (starting frame sent separately):
            </div>
            <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-800">
              {fullPrompt || "(empty)"}
            </pre>
            {job.mode === "prepare" && (
              <>
                <div className="mt-1 text-slate-500">
                  Starting-image prompt (reference images sent separately):
                </div>
                <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-800">
                  {composePrompt(shared, still) || "(empty)"}
                </pre>
              </>
            )}
          </details>
        </div>
      </div>

      {/* ---- status / results ---- */}
      {progress != null && job.state !== "completed" && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded bg-slate-100">
            <div
              className={`h-full bg-sky-500 transition-all ${job.state === "generating" ? "animate-pulse" : ""}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {job.state === "queued" && "Waiting for a free slot…"}
            {job.state === "preparing_image" &&
              "Image model is preparing the starting image…"}
            {job.state === "submitting" && "Sending to the provider…"}
            {job.state === "generating" && (
              <>
                Provider status: {job.providerStatus ?? "pending"} ·{" "}
                {elapsed(job.submittedAt)} · job{" "}
                {job.providerJobId?.slice(0, 22)}
                <div className="text-slate-500">
                  Submitted jobs can&apos;t be cancelled with this provider;
                  closing the page won&apos;t stop it or its billing. Polling
                  resumes after a restart.
                </div>
              </>
            )}
            {job.state === "downloading" && "Saving the video locally…"}
          </div>
        </div>
      )}
      {job.pollError && (
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
          Having trouble checking status (still retrying): {job.pollError}
        </p>
      )}

      {job.state === "awaiting_image_approval" && job.still && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-medium">
            Review the prepared starting image. No video has been paid for yet.
          </div>
          <div className="mt-2 flex flex-wrap gap-4">
            {startImg && (
              <figure className="text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/images/${startImg.id}/file`}
                  alt="original"
                  className="h-40 rounded border bg-white object-contain"
                />
                <figcaption>Original</figcaption>
              </figure>
            )}
            <figure className="text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/jobs/${job.id}/still?${job.still.createdAt}`}
                alt="prepared"
                className="h-40 rounded border bg-white object-contain"
              />
              <figcaption>
                Prepared
                {job.still.costUsd != null
                  ? ` · ${money(job.still.costUsd)}`
                  : ""}
              </figcaption>
            </figure>
          </div>
          <div className="mt-2 flex gap-2 text-sm">
            <button
              disabled={!!busy}
              onClick={() => {
                if (
                  confirm(
                    "Generate the video from this image? This is a paid request.",
                  )
                )
                  void act("approve", () =>
                    post(`/api/jobs/${job.id}/approve-still`),
                  );
              }}
              className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-40"
            >
              Approve &amp; generate video
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                void act("discard", () =>
                  post(`/api/jobs/${job.id}/discard-still`),
                )
              }
              className="rounded border px-3 py-1.5"
            >
              Discard (edit prompt &amp; try again)
            </button>
          </div>
        </div>
      )}

      {job.state === "submission_uncertain" && (
        <div className="mt-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm">
          <b>Submission uncertain.</b> {job.error}
          <p className="mt-1 text-xs">
            Check your OpenRouter activity page for a{" "}
            {job.uncertainStage === "still" ? "image" : "video"} generation
            around{" "}
            {job.submittedAt
              ? new Date(job.submittedAt).toLocaleTimeString()
              : "this time"}
            . This app will not resubmit on its own.
          </p>
          <button
            disabled={!!busy}
            onClick={() => {
              if (
                confirm(
                  "Only continue if you checked and nothing was submitted. A retry may be charged again if the first attempt did go through.",
                )
              ) {
                void act("clear", () =>
                  post(`/api/jobs/${job.id}/clear-uncertain`, {
                    confirm: true,
                  }),
                );
              }
            }}
            className="mt-2 rounded border border-orange-400 bg-white px-3 py-1 text-xs"
          >
            I checked — it was not submitted
          </button>
        </div>
      )}

      {job.state === "failed" && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {job.error ?? "Failed."}
          <div className="mt-2">
            <button
              disabled={!!busy}
              onClick={() => {
                const dl =
                  job.providerJobId && job.providerStatus === "completed";
                if (
                  dl ||
                  confirm("Retry this job? A new generation may be charged.")
                ) {
                  void act("retry", () =>
                    post(`/api/jobs/${job.id}/retry`, { confirm: true }),
                  );
                }
              }}
              className="rounded bg-rose-700 px-3 py-1 text-xs text-white disabled:opacity-40"
            >
              {job.providerJobId && job.providerStatus === "completed"
                ? "Retry download (free)"
                : "Retry job…"}
            </button>
          </div>
        </div>
      )}

      {job.state === "completed" && job.output && (
        <div className="mt-3">
          <video
            src={`/api/jobs/${job.id}/video`}
            controls
            preload="metadata"
            className="max-h-72 rounded border bg-black"
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <b>{job.output.file}</b>
            <span>
              {job.output.format.toUpperCase()}
              {job.output.contentType
                ? ` (${job.output.contentType})`
                : ""} · {(job.output.bytes / 1048576).toFixed(2)} MB
            </span>
            {job.costUsd != null && <span>cost {money(job.costUsd)}</span>}
            <a
              href={`/api/jobs/${job.id}/video?download=1`}
              className="rounded bg-slate-800 px-2 py-1 text-white"
            >
              Download
            </a>
            {job.output.format !== "mp4" && (
              <span className="text-amber-700">
                Not MP4 — PowerPoint may not play this.
              </span>
            )}
          </div>
        </div>
      )}

      {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
    </article>
  );
}
