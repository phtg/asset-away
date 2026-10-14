"use client";

import { useMemo, useState } from "react";
import type { Item } from "@/lib/types";
import { isKeyableClient } from "./helpers";
import { Btn, StateBadge, Swatch, Thumb } from "./ui";
import { patch, type TabProps } from "./api";

type Status = "active" | "kept" | "pending" | "rejected" | "all";
type Type = "all" | "image" | "clip" | "plate";

export function LibraryTab({ state, refresh, review }: TabProps) {
  const p = state.project;
  const [type, setType] = useState<Type>("all");
  const [status, setStatus] = useState<Status>("active");
  const [batch, setBatch] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());

  // export options
  const [bgMode, setBgMode] = useState<"transparent" | "color">(
    p.background.mode,
  );
  const [color, setColor] = useState(
    p.background.mode === "color"
      ? p.background.color
      : (state.settings.savedColors[0] ?? "#ffffff"),
  );
  const [fmt, setFmt] = useState<Record<string, boolean>>({
    png: true,
    mp4: true,
    gif: false,
    webm: false,
    original: false,
  });
  const [similarity, setSimilarity] = useState(0.15);
  const [pingPong, setPingPong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const all = useMemo(
    () => state.items.filter((i) => i.state === "completed" && i.file),
    [state.items],
  );
  const images = all.filter((i) => i.kind === "image" && i.origin !== "plate");
  const visible = useMemo(() => {
    return all
      .filter((i) => {
        if (type === "image" && !(i.kind === "image" && i.origin !== "plate"))
          return false;
        if (type === "clip" && i.kind !== "clip") return false;
        if (type === "plate" && i.origin !== "plate") return false;
        if (type === "all" && i.origin === "plate") return false;
        if (status === "active" && i.verdict === "rejected") return false;
        if (status === "kept" && i.verdict !== "kept") return false;
        if (status === "pending" && i.verdict !== "pending") return false;
        if (status === "rejected" && i.verdict !== "rejected") return false;
        if (batch && i.batchId !== batch) return false;
        if (source && i.sourceId !== source) return false;
        if (
          q &&
          !`${i.name} ${i.prompt}`.toLowerCase().includes(q.toLowerCase())
        )
          return false;
        return true;
      })
      .sort((a, b) =>
        (b.completedAt ?? b.createdAt).localeCompare(
          a.completedAt ?? a.createdAt,
        ),
      );
  }, [all, type, status, batch, source, q]);

  const chosen = visible.filter((i) => sel.has(i.id));
  const nImg = chosen.filter((i) => i.kind === "image").length;
  const nClip = chosen.filter((i) => i.kind === "clip").length;
  const nKeyable = chosen.filter(isKeyableClient).length;
  const usedColor = bgMode === "color" ? color : null;
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  };
  const srcOf = (c: Item) => state.items.find((i) => i.id === c.sourceId);
  const palette = [
    ...new Set([...state.settings.savedColors, "#ffffff", "#000000"]),
  ];

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const formats = Object.entries(fmt)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds: chosen.map((i) => i.id),
          formats,
          background: { mode: bgMode, color },
          similarity,
          pingPong,
        }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? res.statusText,
        );
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `asset-away-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const batchOptions = state.batches.filter((b) =>
    all.some((i) => i.batchId === b.id),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="mr-2 text-lg font-semibold">Library</h2>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as Type)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="all">Images + animations</option>
            <option value="image">Images</option>
            <option value="clip">Animations</option>
            <option value="plate">Green screens</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="active">Kept + to review</option>
            <option value="kept">Kept</option>
            <option value="pending">To review</option>
            <option value="rejected">Rejected</option>
            <option value="all">Everything</option>
          </select>
          <select
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            className="max-w-[11rem] rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All batches</option>
            {batchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} · {new Date(b.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="max-w-[11rem] rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All source images</option>
            {images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <Btn onClick={() => setSel(new Set(visible.map((i) => i.id)))}>
            Select all ({visible.length})
          </Btn>
          <Btn
            kind="ghost"
            onClick={() => setSel(new Set())}
            disabled={!sel.size}
          >
            Clear
          </Btn>
        </div>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-500">
            Nothing here yet (or everything is filtered out).
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((it) => {
              const s = it.kind === "clip" ? srcOf(it) : null;
              const plate = s
                ? state.items.find((i) => i.id === s.plateId)
                : null;
              return (
                <div
                  key={it.id}
                  className={`group relative rounded-lg border bg-white p-2 ${sel.has(it.id) ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200"} ${it.verdict === "rejected" ? "opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={sel.has(it.id)}
                    onChange={() => toggle(it.id)}
                    className="absolute left-3 top-3 z-10 h-4 w-4"
                    aria-label={`Select ${it.name}`}
                  />
                  <button
                    className="relative block w-full"
                    onClick={() =>
                      review(
                        it.id,
                        visible.map((v) => v.id),
                      )
                    }
                  >
                    {it.kind === "image" ? (
                      <Thumb
                        item={it}
                        className="aspect-square w-full"
                        bg={usedColor && it.file?.hasAlpha ? usedColor : null}
                      />
                    ) : (
                      <>
                        <Thumb
                          item={plate ?? s ?? it}
                          className="aspect-square w-full"
                          bg={plate ? p.keyColor : null}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow">
                          ▶
                        </span>
                      </>
                    )}
                  </button>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span
                      className="truncate text-sm font-medium"
                      title={it.name}
                    >
                      {it.name}
                    </span>
                    <StateBadge item={it} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate">
                      {it.kind === "clip"
                        ? `${s?.name ?? "?"} · ${it.run?.duration ?? "?"}s`
                        : `${it.file?.hasAlpha ? "transparent" : "opaque"} ${it.file?.format.toUpperCase()}`}
                    </span>
                    <a
                      className="hover:underline"
                      href={`/api/items/${it.id}/file?download=1`}
                      title="Download original"
                    >
                      ⤓
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-28 lg:self-start">
        <h3 className="font-semibold">Export</h3>
        <p className="text-sm text-slate-600">
          {chosen.length
            ? `${chosen.length} selected: ${nImg} image${nImg === 1 ? "" : "s"}, ${nClip} clip${nClip === 1 ? "" : "s"}`
            : "Tick items in the grid to export them."}
        </p>

        <div>
          <div className="text-sm font-medium">Background</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Swatch
              color={null}
              selected={bgMode === "transparent"}
              onClick={() => setBgMode("transparent")}
              title="Transparent"
            />
            {palette.map((c) => (
              <Swatch
                key={c}
                color={c}
                selected={bgMode === "color" && color === c}
                onClick={() => {
                  setColor(c);
                  setBgMode("color");
                }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setBgMode("color");
              }}
              className="h-7 w-9 cursor-pointer rounded border"
              aria-label="Custom colour"
            />
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">
              {bgMode === "color" ? color : "transparent"}
            </span>
            {bgMode === "color" &&
              !state.settings.savedColors.includes(color) && (
                <button
                  className="text-sky-700 underline"
                  onClick={() =>
                    void patch("/api/settings", {
                      savedColors: [...state.settings.savedColors, color],
                    }).then(refresh)
                  }
                >
                  save colour
                </button>
              )}
            <button
              className="ml-auto text-sky-700 underline"
              onClick={() =>
                void patch(`/api/projects/${p.id}`, {
                  background:
                    bgMode === "color"
                      ? { mode: "color", color }
                      : { mode: "transparent" },
                }).then(refresh)
              }
            >
              make project default
            </button>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <div className="font-medium">Formats</div>
          {[
            ["png", "PNG (images)"],
            ["mp4", "MP4 (clips, needs a colour)"],
            ["gif", "GIF (clips, transparent ok)"],
            ["webm", "WebM with alpha (clips, transparent)"],
            ["original", "Original files"],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!fmt[k]}
                onChange={(e) => setFmt({ ...fmt, [k]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <p className="text-xs text-slate-500">
            PowerPoint plays MP4 and GIF (not WebM). GIF transparency is on/off
            only, so edges are slightly jagged.
          </p>
        </div>

        {nKeyable > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Keying options
            </summary>
            <label className="mt-2 block text-xs">
              Edge tolerance: {similarity.toFixed(2)}
              <input
                type="range"
                min={0.05}
                max={0.4}
                step={0.01}
                value={similarity}
                onChange={(e) => setSimilarity(Number(e.target.value))}
                className="w-full"
              />
              <span className="text-slate-500">
                Raise if green fringes remain; lower if the subject gets holes.
                Preview it in the viewer.
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={pingPong}
                onChange={(e) => setPingPong(e.target.checked)}
                className="mt-0.5"
              />
              Ping-pong (play forward then backward) so clips loop smoothly
            </label>
          </details>
        )}

        {!state.ffmpeg.available && (
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
            ffmpeg is needed for colours, GIF and WebM: brew install ffmpeg
          </p>
        )}
        {err && (
          <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{err}</p>
        )}
        <Btn
          kind="primary"
          className="w-full"
          disabled={!chosen.length || busy}
          onClick={download}
        >
          {busy
            ? "Rendering… (first time can take a while)"
            : `Download ZIP (${chosen.length})`}
        </Btn>
        <p className="text-xs text-slate-500">
          The ZIP includes manifest.json with prompts, models and settings.
        </p>
      </aside>
    </div>
  );
}
