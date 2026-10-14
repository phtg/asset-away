"use client";

import { useMemo, useState } from "react";
import { parseBulkPrompts } from "@/lib/parse";
import type { Batch, Item } from "@/lib/types";
import { batchTitle, isBusy } from "./helpers";
import { Btn, StateBadge, Thumb } from "./ui";
import { api, patch, post, type PlanResponse, type TabProps } from "./api";

export function ImagesTab({ state, refresh, review, run, goto }: TabProps) {
  const p = state.project;
  const images = useMemo(
    () =>
      state.items.filter((i) => i.kind === "image" && i.origin === "generated"),
    [state.items],
  );
  const [openBatches, setOpenBatches] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState<null | "suggest" | "paste">(null);
  const [text, setText] = useState("");
  const [count, setCount] = useState(5);
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const batches = [...state.batches.filter((b) => b.kind === "image")].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
  const loose = images.filter(
    (i) => !i.batchId || !batches.some((b) => b.id === i.batchId),
  );
  const selected = images.filter((i) => i.include && i.state === "draft");
  const toReview = images.filter(
    (i) => i.state === "completed" && i.verdict === "pending",
  );
  const queued = images.filter((i) => i.state === "queued").length;
  const hasAnchor = !!state.items.find((i) => i.id === p.anchorId);

  const suggest = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ ideas: { name: string; prompt: string }[] }>(
        "/api/helpers",
        { kind: "poses", projectId: p.id, count, theme },
      );
      await post("/api/items/bulk", {
        projectId: p.id,
        kind: "image",
        label: `Poses · ${theme || "ideas"}`.slice(0, 60),
        items: r.ideas,
      });
      setPanel(null);
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    const { blocks, warnings } = parseBulkPrompts(text);
    if (!blocks.length) return;
    await post("/api/items/bulk", {
      projectId: p.id,
      kind: "image",
      label: "Pasted prompts",
      items: blocks.map((b) => ({ name: b.name, prompt: b.actionPrompt })),
    });
    setText("");
    setPanel(null);
    setMsg(warnings.join(" "));
    refresh();
  };

  const isOpen = (b: Batch, idx: number) => openBatches[b.id] ?? idx === 0;

  return (
    <div className="space-y-4">
      <div className="sticky top-[3.1rem] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <h2 className="mr-2 text-lg font-semibold">Images</h2>
        <Btn
          onClick={() => setPanel(panel === "suggest" ? null : "suggest")}
          disabled={!hasAnchor || !state.settings.helperModel}
          title={
            !hasAnchor
              ? "Set a style anchor first (Style tab)"
              : !state.settings.helperModel
                ? "Choose a helper model in Settings"
                : "Asks a vision model to propose poses"
          }
        >
          ✨ Suggest poses
        </Btn>
        <Btn onClick={() => setPanel(panel === "paste" ? null : "paste")}>
          Paste prompts
        </Btn>
        <Btn
          onClick={async () => {
            await post("/api/items/bulk", {
              projectId: p.id,
              kind: "image",
              label: "Single",
              items: [{ name: "New image", prompt: "" }],
            });
            refresh();
          }}
        >
          + Add one
        </Btn>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {toReview.length > 0 && (
            <Btn
              kind="primary"
              onClick={() =>
                review(
                  toReview[0].id,
                  toReview.map((i) => i.id),
                )
              }
            >
              Review {toReview.length} new
            </Btn>
          )}
          {queued > 0 && (
            <Btn
              onClick={async () => {
                if (
                  confirm(
                    "Return queued items to draft?\n\nRequests already sent to the provider can't be cancelled.",
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
            disabled={!selected.length}
            onClick={() => run(selected.map((i) => i.id))}
          >
            Generate selected ({selected.length})
          </Btn>
        </div>
      </div>

      {panel === "suggest" && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={12}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-16 rounded border px-2 py-1"
            />
            <span>poses/variants, based on your style anchor</span>
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Direction, e.g. customer support: waving, pointing, peeking, thinking"
              className="min-w-0 flex-1 rounded border px-2 py-1"
            />
            <Btn kind="primary" onClick={suggest} disabled={busy}>
              {busy ? "Asking…" : "Suggest"}
            </Btn>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            One paid chat call. The ideas become editable draft cards; nothing
            is generated until you click Generate.
          </p>
        </div>
      )}
      {panel === "paste" && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={
              "Waving\nThe character waves with its right hand, smiling.\n---\nPeeking\nThe character peeks out from behind a panel."
            }
            className="w-full rounded border border-slate-300 p-2 font-mono text-sm"
          />
          <div className="mt-2 flex gap-2">
            <Btn
              kind="primary"
              onClick={paste}
              disabled={!parseBulkPrompts(text).blocks.length}
            >
              Create {parseBulkPrompts(text).blocks.length || ""} card(s)
            </Btn>
            <span className="self-center text-xs text-slate-500">
              Name on the first line, prompt below, blocks separated by a line
              with three hyphens.
            </span>
          </div>
        </div>
      )}
      {msg && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">{msg}</p>
      )}

      {!hasAnchor && images.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
          Start on the{" "}
          <button
            className="font-semibold underline"
            onClick={() => goto("style")}
          >
            Style tab
          </button>
          : add a reference image (or describe the asset and create concept
          cards).
        </div>
      )}

      {[
        ...batches,
        ...(loose.length
          ? [
              {
                id: "__loose",
                projectId: p.id,
                kind: "image" as const,
                label: "Other",
                createdAt: "",
              },
            ]
          : []),
      ].map((b, idx) => {
        const items =
          b.id === "__loose" ? loose : images.filter((i) => i.batchId === b.id);
        if (!items.length) return null;
        const open = isOpen(b, idx);
        const done = items.filter((i) => i.state === "completed");
        const kept = done.filter((i) => i.verdict === "kept").length;
        const rejected = done.filter((i) => i.verdict === "rejected").length;
        const list = done.map((i) => i.id);
        return (
          <section
            key={b.id}
            className="rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              onClick={() => setOpenBatches({ ...openBatches, [b.id]: !open })}
            >
              <span className="text-slate-400">{open ? "▾" : "▸"}</span>
              <span className="font-semibold">{b.label}</span>
              {b.createdAt && (
                <span className="text-xs text-slate-500">
                  {batchTitle(b.createdAt)}
                </span>
              )}
              <span className="ml-auto text-xs text-slate-500">
                {items.length} cards · {done.length} generated · {kept} kept
                {rejected ? ` · ${rejected} rejected` : ""}
              </span>
            </button>
            {open && (
              <div className="grid gap-3 border-t p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((it) => (
                  <ImageCard
                    key={it.id}
                    item={it}
                    refresh={refresh}
                    onOpen={() => review(it.id, list)}
                    run={run}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ImageCard({
  item,
  refresh,
  onOpen,
  run,
}: {
  item: Item;
  refresh: () => void;
  onOpen: () => void;
  run: (ids: string[]) => void;
}) {
  const [prompt, setPrompt] = useState(item.prompt);
  const [name, setName] = useState(item.name);
  const [preview, setPreview] = useState<string | null>(null);
  const editable = item.state === "draft" || item.state === "failed";
  const save = (b: Record<string, unknown>) =>
    patch(`/api/items/${item.id}`, b)
      .then(refresh)
      .catch(() => {});

  const showPrompt = async () => {
    try {
      const r = await post<PlanResponse>("/api/run/plan", { ids: [item.id] });
      const it = r.items[0];
      setPreview(it.fullPrompt ?? it.errors.join(" "));
    } catch (e) {
      setPreview((e as Error).message);
    }
  };

  return (
    <article
      className={`flex flex-col rounded-lg border p-2 ${item.verdict === "rejected" ? "border-slate-200 opacity-50" : item.verdict === "kept" ? "border-emerald-300" : "border-slate-200"}`}
    >
      <div className="relative">
        {item.state === "completed" ? (
          <button
            onClick={onOpen}
            className="block w-full"
            title="Open to review"
          >
            <Thumb item={item} className="aspect-square w-full" />
          </button>
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-2 text-center text-xs text-slate-500">
            {isBusy(item) ? (
              <>
                <div className="mb-2 h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                {item.state === "queued"
                  ? "Waiting for a slot…"
                  : "Generating…"}
              </>
            ) : item.state === "draft" ? (
              "Draft: edit the prompt, then generate"
            ) : (
              <StateBadge item={item} />
            )}
          </div>
        )}
        <div className="absolute left-1 top-1 flex items-center gap-1">
          {item.state === "draft" && (
            <input
              type="checkbox"
              checked={item.include}
              onChange={(e) => void save({ include: e.target.checked })}
              aria-label="Include in next generation"
              className="h-4 w-4"
            />
          )}
        </div>
        <div className="absolute right-1 top-1">
          <StateBadge item={item} />
        </div>
      </div>
      <input
        value={name}
        disabled={
          item.state !== "draft" &&
          item.state !== "failed" &&
          item.state !== "completed"
        }
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== item.name && void save({ name })}
        className="mt-2 rounded border border-transparent px-1 py-0.5 text-sm font-semibold hover:border-slate-300"
        aria-label="Name"
      />
      <textarea
        value={prompt}
        rows={item.state === "draft" ? 4 : 2}
        disabled={!editable}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => prompt !== item.prompt && void save({ prompt })}
        className="mt-1 rounded border border-slate-200 p-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-500"
        aria-label="Prompt"
      />
      {item.state === "draft" && (
        <div className="mt-1 flex items-center justify-between text-xs">
          <button className="text-sky-700 underline" onClick={showPrompt}>
            Show full prompt
          </button>
          <button
            className="text-rose-600 hover:underline"
            onClick={() =>
              void api(`/api/items/${item.id}`, { method: "DELETE" }).then(
                refresh,
              )
            }
          >
            Delete
          </button>
        </div>
      )}
      {preview && (
        <div className="mt-1 rounded bg-slate-50 p-2 text-xs">
          <pre className="whitespace-pre-wrap">{preview}</pre>
          <button
            className="mt-1 text-sky-700 underline"
            onClick={() => setPreview(null)}
          >
            hide
          </button>
        </div>
      )}
      {item.state === "failed" && (
        <div className="mt-1 rounded bg-rose-50 p-2 text-xs text-rose-800">
          {item.error}
          <div className="mt-1">
            <Btn
              kind="danger"
              className="!px-2 !py-0.5 !text-xs"
              onClick={() =>
                confirm("Retry this image? It may be charged again.") &&
                void post(`/api/items/${item.id}/retry`, {
                  confirm: true,
                }).then(refresh)
              }
            >
              Retry…
            </Btn>
          </div>
        </div>
      )}
      {item.state === "submission_uncertain" && (
        <div className="mt-1 rounded bg-orange-50 p-2 text-xs text-orange-900">
          <b>Submission uncertain.</b> {item.error}
          <div className="mt-1">
            <Btn
              className="!px-2 !py-0.5 !text-xs"
              onClick={() =>
                confirm(
                  "Only continue if you checked OpenRouter activity and nothing was generated.",
                ) &&
                void post(`/api/items/${item.id}/clear-uncertain`, {
                  confirm: true,
                }).then(refresh)
              }
            >
              I checked — it wasn&apos;t submitted
            </Btn>
          </div>
        </div>
      )}
      {item.state === "completed" && (
        <div className="mt-2 flex gap-1">
          <Btn
            kind="success"
            className="!px-2 !py-1 !text-xs"
            disabled={item.verdict === "kept"}
            onClick={() =>
              void post(`/api/items/${item.id}/verdict`, {
                verdict: "kept",
              }).then(refresh)
            }
          >
            ✓ Keep
          </Btn>
          <Btn
            kind="danger"
            className="!px-2 !py-1 !text-xs"
            disabled={item.verdict === "rejected"}
            onClick={() =>
              void post(`/api/items/${item.id}/verdict`, {
                verdict: "rejected",
              }).then(refresh)
            }
          >
            ✗
          </Btn>
          <Btn
            className="!px-2 !py-1 !text-xs"
            title="Reject and create a fresh draft with the same prompt"
            onClick={async () => {
              const r = await post<{ item: Item }>(
                `/api/items/${item.id}/regenerate`,
              );
              refresh();
              run([r.item.id]);
            }}
          >
            ↻
          </Btn>
          {item.error && (
            <span title={item.error} className="self-center text-amber-600">
              ⚠
            </span>
          )}
        </div>
      )}
    </article>
  );
}
