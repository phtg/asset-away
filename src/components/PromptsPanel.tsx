"use client";

import { useRef, useState } from "react";
import {
  parseBulkPrompts,
  parseJobListJson,
  type ExportedJobList,
} from "@/lib/parse";
import {
  DEFAULT_SHARED_INSTRUCTIONS,
  type ImageRecord,
  type Job,
} from "@/lib/types";
import { patch, post } from "./api";

export function PromptsPanel({
  shared,
  images,
  jobs,
  helperReady,
  refresh,
}: {
  shared: string;
  images: ImageRecord[];
  jobs: Job[];
  helperReady: boolean;
  refresh: () => void;
}) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [ideaCount, setIdeaCount] = useState(6);
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [sharedDraft, setSharedDraft] = useState(shared);
  const editingShared = useRef(false);
  if (!editingShared.current && sharedDraft !== shared) setSharedDraft(shared);

  const parsed = parseBulkPrompts(text);

  const addJobs = async () => {
    if (!parsed.blocks.length) return;
    await post("/api/jobs", { jobs: parsed.blocks });
    setNotes(parsed.warnings);
    setText("");
    refresh();
  };

  const exportJson = () => {
    const out: ExportedJobList = {
      format: "asset-away-jobs",
      version: 1,
      sharedInstructions: shared,
      jobs: jobs.map((j) => ({
        name: j.name,
        include: j.include,
        mode: j.mode,
        startImageName:
          images.find((i) => i.id === j.startImageId)?.name ?? null,
        actionPrompt: j.actionPrompt,
        stillPrompt: j.stillPrompt,
        duration: j.duration,
        resolution: j.resolution,
        aspectRatio: j.aspectRatio,
        seed: j.seed,
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "asset-away-jobs.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (f: File) => {
    try {
      const list = parseJobListJson(await f.text());
      if (
        list.sharedInstructions &&
        list.sharedInstructions !== shared &&
        confirm(
          "Also replace the shared instructions with the ones in this file?",
        )
      ) {
        await patch("/api/settings", {
          sharedInstructions: list.sharedInstructions,
        });
      }
      await post("/api/jobs", { jobs: list.jobs });
      setNotes([
        `Imported ${list.jobs.length} job(s) as drafts. Images are matched by name.`,
      ]);
      refresh();
    } catch (e) {
      setNotes([(e as Error).message]);
    }
  };

  const suggest = async () => {
    setBusy(true);
    try {
      const r = await post<{ text: string }>("/api/helpers", {
        kind: "ideas",
        count: ideaCount,
        theme,
      });
      setText((t) => (t.trim() ? `${t.trim()}\n---\n` : "") + r.text);
      setNotes([
        "Suggestions added below. Review/edit them, then parse into job cards.",
      ]);
    } catch (e) {
      setNotes([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">3. Prompts</h2>

      <label className="mt-2 block text-sm font-medium">
        Shared instructions (appended to every job)
      </label>
      <textarea
        value={sharedDraft}
        rows={5}
        onFocus={() => (editingShared.current = true)}
        onChange={(e) => setSharedDraft(e.target.value)}
        onBlur={() => {
          editingShared.current = false;
          if (sharedDraft !== shared)
            void patch("/api/settings", {
              sharedInstructions: sharedDraft,
            }).then(refresh);
        }}
        className="mt-1 w-full rounded border border-slate-300 p-2 text-sm"
      />
      <button
        className="text-xs text-sky-700 hover:underline"
        onClick={() =>
          void patch("/api/settings", {
            sharedInstructions: DEFAULT_SHARED_INSTRUCTIONS,
          }).then(refresh)
        }
      >
        Reset to default
      </button>

      <label className="mt-4 block text-sm font-medium">
        Bulk prompts — name on the first line, motion prompt below, blocks
        separated by <code>---</code>
      </label>
      <textarea
        value={text}
        rows={9}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "Thinking\nThe robot tilts its head thoughtfully, pauses, then returns to its starting pose.\n---\nHello wave\nThe robot gently waves its raised hand twice, then returns to the starting pose."
        }
        className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={addJobs}
          disabled={!parsed.blocks.length}
          className="rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-40"
        >
          Parse into {parsed.blocks.length || ""} job card
          {parsed.blocks.length === 1 ? "" : "s"}
        </button>
        <button
          className="rounded border px-3 py-1.5"
          onClick={async () =>
            setText(await (await fetch("/sample-prompts.txt")).text())
          }
        >
          Load sample
        </button>
        <button
          className="rounded border px-3 py-1.5"
          onClick={exportJson}
          disabled={!jobs.length}
        >
          Export jobs JSON
        </button>
        <button
          className="rounded border px-3 py-1.5"
          onClick={() => file.current?.click()}
        >
          Import jobs JSON
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = "";
          }}
        />
      </div>

      <details className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Suggest animations from the default reference image (optional, paid
          helper)
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={12}
            value={ideaCount}
            onChange={(e) => setIdeaCount(Number(e.target.value))}
            className="w-16 rounded border px-2 py-1"
          />
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Theme, e.g. customer support demo"
            className="min-w-0 flex-1 rounded border px-2 py-1"
          />
          <button
            onClick={suggest}
            disabled={!helperReady || busy}
            title={helperReady ? "" : "Choose a helper model in Provider"}
            className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40"
          >
            {busy ? "Asking…" : "Suggest"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Makes one OpenRouter chat call with your reference image. Nothing is
          added until you parse the text.
        </p>
      </details>

      {(notes.length > 0 || parsed.warnings.length > 0) && (
        <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
          {[...notes, ...parsed.warnings].map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
