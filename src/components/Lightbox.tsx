"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isKeyableClient } from "./helpers";
import type { Item } from "@/lib/types";
import { Btn, CHECKER, StateBadge, Swatch } from "./ui";
import { api, patch, post, type ServerState } from "./api";

export function Lightbox({
  state,
  start,
  refresh,
  run,
  onClose,
}: {
  state: ServerState;
  start: { id: string; list: string[] };
  refresh: () => void;
  run: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState(start.id);
  const list = useMemo(
    () => start.list.filter((x) => state.items.some((i) => i.id === x)),
    [start.list, state.items],
  );
  const idx = Math.max(0, list.indexOf(id));
  const item =
    state.items.find((i) => i.id === id) ??
    state.items.find((i) => i.id === list[0]);
  const project = state.project;
  const anchor = state.items.find((i) => i.id === project.anchorId);

  const colors = useMemo(() => {
    const set = new Set<string>([
      ...state.settings.savedColors,
      "#ffffff",
      "#000000",
    ]);
    if (project.background.mode === "color") set.add(project.background.color);
    return [...set];
  }, [state.settings.savedColors, project.background]);
  // null = transparent (checkerboard), "original" = untouched file
  const [bg, setBg] = useState<string | null>(
    project.background.mode === "color" ? project.background.color : null,
  );
  const [original, setOriginal] = useState(false);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = useCallback(
    (d: number) => {
      if (!list.length) return;
      setId(list[(idx + d + list.length) % list.length]);
      setErr(null);
    },
    [list, idx],
  );

  const decide = useCallback(
    async (verdict: "kept" | "rejected") => {
      if (!item || item.state !== "completed" || busy) return;
      setBusy(true);
      try {
        await post(`/api/items/${item.id}/verdict`, { verdict });
        refresh();
        // jump to the next item still waiting for a decision
        const next = list.find(
          (x, k) =>
            k > idx &&
            state.items.find((i) => i.id === x)?.verdict === "pending",
        );
        if (next) setId(next);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [item, busy, list, idx, state.items, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "")
      )
        return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key.toLowerCase() === "k") void decide("kept");
      else if (e.key.toLowerCase() === "x") void decide("rejected");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, decide, onClose]);

  if (!item) return null;
  const isClip = item.kind === "clip";
  const keyable = isKeyableClient(item);
  const src = state.items.find(
    (i) => i.id === item.sourceId || i.id === item.parentId,
  );
  const canRegen = item.state === "completed" && item.origin !== "upload";

  // what the big viewer shows
  let media: React.ReactNode;
  const viewerStyle =
    !isClip || original || !keyable
      ? undefined
      : bg
        ? { backgroundColor: bg }
        : undefined;
  if (!isClip) {
    media = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/items/${item.id}/file?v=${item.file?.file}`}
        alt={item.name}
        className="max-h-full max-w-full object-contain"
      />
    );
  } else if (original || !keyable) {
    media = (
      <video
        key={item.id + "o"}
        src={`/api/items/${item.id}/file`}
        controls
        autoPlay
        loop
        className="max-h-full max-w-full"
      />
    );
  } else if (bg) {
    const url = `/api/items/${item.id}/preview?bg=${bg.slice(1)}`;
    media = (
      <>
        {loading && (
          <div className="absolute text-sm text-white/80">
            Rendering preview…
          </div>
        )}
        <video
          key={url}
          src={url}
          controls
          autoPlay
          loop
          muted
          onLoadStart={() => setLoading(true)}
          onLoadedData={() => setLoading(false)}
          className="max-h-full max-w-full"
        />
      </>
    );
  } else {
    const url = `/api/items/${item.id}/preview?format=gif`;
    media = (
      <>
        {loading && (
          <div className="absolute text-sm text-slate-500">
            Rendering transparent preview…
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={url}
          src={url}
          alt="transparent preview"
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
          className="max-h-full max-w-full object-contain"
        />
      </>
    );
  }
  const transparentView = isClip ? keyable && !original && !bg : !bg;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900 text-white lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 p-3 text-sm">
          <Btn
            kind="ghost"
            className="!text-white hover:!bg-white/10"
            onClick={onClose}
          >
            ✕ Close (Esc)
          </Btn>
          <span className="text-white/60">
            {idx + 1} / {list.length}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Btn
              kind="ghost"
              className="!text-white hover:!bg-white/10"
              onClick={() => go(-1)}
            >
              ← Prev
            </Btn>
            <Btn
              kind="ghost"
              className="!text-white hover:!bg-white/10"
              onClick={() => go(1)}
            >
              Next →
            </Btn>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 gap-3 px-3">
          {compare && anchor && anchor.id !== item.id && (
            <div
              className={`relative flex min-h-0 flex-1 items-center justify-center rounded-lg ${CHECKER}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/items/${anchor.id}/file`}
                alt="style anchor"
                className="max-h-full max-w-full object-contain"
              />
              <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">
                Style anchor
              </span>
            </div>
          )}
          <div
            className={`relative flex min-h-0 flex-1 items-center justify-center rounded-lg ${transparentView ? CHECKER : ""} ${!viewerStyle && !transparentView ? "bg-black" : ""}`}
            style={viewerStyle}
          >
            {media}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="text-white/60">Background</span>
          {(isClip ? keyable : true) && (
            <>
              <Swatch
                color={null}
                selected={!bg && !original}
                onClick={() => {
                  setBg(null);
                  setOriginal(false);
                  setLoading(true);
                }}
                title="Transparent"
              />
              {colors.map((c) => (
                <Swatch
                  key={c}
                  color={c}
                  selected={bg === c && !original}
                  onClick={() => {
                    setBg(c);
                    setOriginal(false);
                  }}
                />
              ))}
            </>
          )}
          {isClip && keyable && (
            <button
              className={`rounded px-2 py-1 text-xs ${original ? "bg-white text-slate-900" : "bg-white/10"}`}
              onClick={() => setOriginal(!original)}
            >
              Original (green screen)
            </button>
          )}
          {isClip && !keyable && (
            <span className="text-xs text-white/50">
              Not made on a green screen: background can&apos;t be changed.
            </span>
          )}
          {anchor && anchor.id !== item.id && (
            <button
              className={`ml-auto rounded px-2 py-1 text-xs ${compare ? "bg-white text-slate-900" : "bg-white/10"}`}
              onClick={() => setCompare(!compare)}
            >
              Compare with style anchor
            </button>
          )}
        </div>
      </div>

      <aside className="w-full shrink-0 space-y-3 overflow-auto bg-white p-4 text-slate-900 lg:w-96">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold leading-tight">{item.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <StateBadge item={item} />
              <span>
                {isClip
                  ? "Animation"
                  : item.origin === "plate"
                    ? "Green-screen version"
                    : item.origin === "upload"
                      ? "Uploaded"
                      : "Generated image"}
              </span>
              {src && <span>of “{src.name}”</span>}
            </div>
          </div>
        </div>

        {item.state === "completed" ? (
          <div className="flex flex-wrap gap-2">
            <Btn
              kind="success"
              disabled={busy || item.verdict === "kept"}
              onClick={() => decide("kept")}
            >
              ✓ Keep (K)
            </Btn>
            <Btn
              kind="danger"
              disabled={busy || item.verdict === "rejected"}
              onClick={() => decide("rejected")}
            >
              ✗ Reject (X)
            </Btn>
            {canRegen && (
              <Btn
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await post<{ item: Item }>(
                      `/api/items/${item.id}/regenerate`,
                    );
                    refresh();
                    run([r.item.id]);
                  } catch (e) {
                    setErr((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ↻ Regenerate…
              </Btn>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            This item is not finished yet.
          </p>
        )}
        {item.verdict === "pending" &&
          item.state === "completed" &&
          item.origin !== "upload" && (
            <p className="text-xs text-slate-500">
              Keep it to use it for animations and exports. Rejected items stay
              in the Library (filter: Rejected) so nothing is lost.
            </p>
          )}

        <div className="flex flex-wrap gap-2">
          {!isClip &&
            item.state === "completed" &&
            item.verdict === "kept" &&
            item.origin !== "plate" && (
              <Btn
                onClick={async () => {
                  await patch(`/api/projects/${project.id}`, {
                    anchorId: item.id,
                  });
                  refresh();
                }}
                disabled={project.anchorId === item.id}
              >
                {project.anchorId === item.id
                  ? "★ Style anchor"
                  : "☆ Use as style anchor"}
              </Btn>
            )}
          {item.file && (
            <a
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
              href={`/api/items/${item.id}/file?download=1`}
            >
              Download original
            </a>
          )}
        </div>

        {item.error && (
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
            {item.error}
          </p>
        )}
        {err && (
          <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{err}</p>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {item.file && (
            <>
              <dt className="text-slate-500">File</dt>
              <dd>
                {item.file.file} · {item.file.format.toUpperCase()} ·{" "}
                {(item.file.bytes / 1048576).toFixed(2)} MB
                {item.file.width
                  ? ` · ${item.file.width}×${item.file.height}`
                  : ""}
                {!isClip &&
                  ` · ${item.file.hasAlpha ? "transparent" : "opaque"}`}
              </dd>
            </>
          )}
          {item.run && (
            <>
              <dt className="text-slate-500">Model</dt>
              <dd>{item.run.model}</dd>
            </>
          )}
          {isClip && item.run && (
            <>
              <dt className="text-slate-500">Settings</dt>
              <dd>
                {item.run.duration}s · {item.run.resolution}
                {item.run.aspectRatio
                  ? ` · ${item.run.aspectRatio}`
                  : ""} ·{" "}
                {item.loop ? `loop (${item.run.loopMode})` : "no loop"}
              </dd>
            </>
          )}
          {item.costUsd != null && (
            <>
              <dt className="text-slate-500">Cost</dt>
              <dd>${item.costUsd.toFixed(3)}</dd>
            </>
          )}
          {item.suggestion?.reason && (
            <>
              <dt className="text-slate-500">Why these settings</dt>
              <dd>✨ {item.suggestion.reason}</dd>
            </>
          )}
        </dl>

        {item.prompt && (
          <div>
            <div className="text-xs font-medium text-slate-500">Prompt</div>
            <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm">
              {item.prompt}
            </p>
          </div>
        )}
        {item.run && (
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500">
              Complete prompt that was submitted
            </summary>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2">
              {item.run.fullPrompt}
            </pre>
          </details>
        )}
        <div className="pt-2">
          <Btn
            kind="danger"
            disabled={
              ![
                "completed",
                "failed",
                "draft",
                "submission_uncertain",
              ].includes(item.state)
            }
            onClick={async () => {
              if (!confirm(`Delete “${item.name}” and its file?`)) return;
              try {
                await api(`/api/items/${item.id}`, { method: "DELETE" });
                refresh();
                if (list.length <= 1) onClose();
                else go(1);
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Delete…
          </Btn>
        </div>
      </aside>
    </div>
  );
}
