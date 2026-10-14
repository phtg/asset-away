"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_STYLE_RULES,
  type Project,
  type ProjectKind,
} from "@/lib/types";
import { Btn, Swatch, Thumb } from "./ui";
import { api, patch, post, type TabProps } from "./api";

function useDraft(value: string, save: (v: string) => void) {
  const [v, setV] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setV(value);
  }, [value]);
  return {
    value: v,
    onFocus: () => (editing.current = true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV(e.target.value),
    onBlur: () => {
      editing.current = false;
      if (v !== value) save(v);
    },
  };
}

export function StyleTab({ state, refresh, goto, review }: TabProps) {
  const p = state.project;
  const save = (body: Record<string, unknown>) =>
    patch(`/api/projects/${p.id}`, body).then(refresh);
  const refs = state.items.filter(
    (i) => i.kind === "image" && i.origin === "upload",
  );
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [concepts, setConcepts] = useState(2);

  const name = useDraft(p.name, (v) => save({ name: v }));
  const brief = useDraft(p.brief, (v) => save({ brief: v }));
  const styleRules = useDraft(p.styleRules, (v) => save({ styleRules: v }));
  const animRules = useDraft(p.animationRules, (v) =>
    save({ animationRules: v }),
  );

  const upload = async (files: FileList | File[]) => {
    const form = new FormData();
    form.append("projectId", p.id);
    for (const f of Array.from(files)) form.append("files", f);
    setMsg("Uploading…");
    try {
      const r = await api<{ rejected: { name: string; reason: string }[] }>(
        "/api/items/upload",
        { method: "POST", body: form },
      );
      setMsg(
        r.rejected.length
          ? r.rejected.map((x) => `${x.name}: ${x.reason}`).join(" · ")
          : null,
      );
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const makeConcepts = async () => {
    const prompt = p.brief.trim();
    if (!prompt)
      return setMsg("Describe the asset first, then generate concepts.");
    await post("/api/items/bulk", {
      projectId: p.id,
      kind: "image",
      label: "Concepts",
      items: Array.from({ length: concepts }, (_, i) => ({
        name: `Concept ${i + 1}`,
        prompt: `${prompt} (concept ${i + 1}: explore a different take)`,
      })),
    });
    refresh();
    goto("images");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">What are you making?</h2>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            {...name}
            className="rounded-md border border-slate-300 px-3 py-2 font-medium"
            aria-label="Project name"
          />
          <select
            value={p.kind}
            onChange={(e) => {
              const kind = e.target.value as ProjectKind;
              void save({
                kind,
                ...(p.styleRules === DEFAULT_STYLE_RULES[p.kind]
                  ? { styleRules: DEFAULT_STYLE_RULES[kind] }
                  : {}),
              });
            }}
            className="rounded-md border border-slate-300 px-2"
          >
            <option value="mascot">Mascot / character</option>
            <option value="icon">Icon set</option>
            <option value="illustration">Illustration style</option>
            <option value="other">Other</option>
          </select>
        </div>

        <label className="block text-sm">
          <span className="font-medium">Describe the asset and its style</span>
          <textarea
            {...brief}
            rows={4}
            placeholder="e.g. A friendly white robot mascot with black joints, a black face display with cyan expressions, and a headset. Glossy 3D render, soft studio lighting."
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          />
          <span className="text-xs text-slate-500">
            Used for concepts and for planning poses and animations.
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium">Style rules for every image</span>
          <textarea
            {...styleRules}
            rows={4}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          />
          <button
            className="text-xs text-sky-700 underline"
            onClick={() => save({ styleRules: DEFAULT_STYLE_RULES[p.kind] })}
          >
            Reset to default for {p.kind}
          </button>
        </label>

        <label className="block text-sm">
          <span className="font-medium">Motion rules for every animation</span>
          <textarea
            {...animRules}
            rows={4}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          />
        </label>

        <BackgroundSettings
          p={p}
          savedColors={state.settings.savedColors}
          save={save}
          refresh={refresh}
        />
      </section>

      <section className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Reference images</h2>
          <p className="mt-1 text-xs text-slate-600">
            Upload images that define the style. The ★ <b>style anchor</b> is
            sent with every image request so new images match it. You can skip
            this and generate concepts from your description instead.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (e.dataTransfer.files.length)
                void upload(e.dataTransfer.files);
            }}
            onClick={() => input.current?.click()}
            className={`mt-3 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm ${over ? "border-sky-500 bg-sky-50" : "border-slate-300 text-slate-500"}`}
          >
            Drop PNG, JPEG or WebP here, or click to choose (max{" "}
            {state.maxUploadMb} MB each)
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {msg && <p className="mt-2 text-sm text-amber-700">{msg}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {refs.map((img) => (
              <div
                key={img.id}
                className={`rounded-lg border p-2 ${img.id === p.anchorId ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200"}`}
              >
                <button
                  className="block w-full"
                  onClick={() =>
                    review(
                      img.id,
                      refs.map((r) => r.id),
                    )
                  }
                >
                  <Thumb item={img} className="aspect-square w-full" />
                </button>
                <input
                  defaultValue={img.name}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== img.name &&
                    void patch(`/api/items/${img.id}`, {
                      name: e.target.value,
                    }).then(refresh)
                  }
                  className="mt-2 w-full rounded border border-slate-200 px-1 py-0.5 text-sm"
                  aria-label="Image name"
                />
                <div className="mt-1 flex items-center justify-between text-xs">
                  <button
                    className={
                      img.id === p.anchorId
                        ? "font-semibold text-sky-700"
                        : "text-slate-600 hover:underline"
                    }
                    onClick={() => save({ anchorId: img.id })}
                  >
                    {img.id === p.anchorId ? "★ Style anchor" : "☆ Make anchor"}
                  </button>
                  <button
                    className="text-rose-600 hover:underline"
                    onClick={() =>
                      confirm(`Remove “${img.name}”?`) &&
                      void api(`/api/items/${img.id}`, {
                        method: "DELETE",
                      }).then(refresh)
                    }
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {img.file?.width
                    ? `${img.file.width}×${img.file.height} · `
                    : ""}
                  {img.file?.hasAlpha ? "transparent" : "opaque"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold">
            No reference yet? Start from your description
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Creates draft concept cards from the description above. You review
            the prompts, then generate. Keep your favourite and make it the
            anchor.
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={1}
              max={6}
              value={concepts}
              onChange={(e) => setConcepts(Number(e.target.value))}
              className="w-16 rounded border border-slate-300 px-2 py-1"
            />
            <span>concepts</span>
            <Btn kind="primary" onClick={makeConcepts}>
              Create concept cards →
            </Btn>
          </div>
        </div>

        <div className="flex justify-end">
          <Btn
            kind="primary"
            onClick={() => goto("images")}
            disabled={
              !refs.length && !state.items.some((i) => i.kind === "image")
            }
          >
            Next: plan images →
          </Btn>
        </div>
      </section>
    </div>
  );
}

function BackgroundSettings({
  p,
  savedColors,
  save,
  refresh,
}: {
  p: Project;
  savedColors: string[];
  save: (b: Record<string, unknown>) => Promise<void>;
  refresh: () => void;
}) {
  const [custom, setCustom] = useState(p.background.color);
  return (
    <fieldset className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm">
      <legend className="px-1 font-medium">Backgrounds</legend>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={p.cutout}
          onChange={(e) => save({ cutout: e.target.checked })}
          className="mt-1"
        />
        <span>
          Isolated subject (cut-out)
          <span className="block text-xs text-slate-500">
            Images are made on a transparent background (or green, then keyed
            out). Untick for full scenes.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={p.greenScreen}
          onChange={(e) => save({ greenScreen: e.target.checked })}
          className="mt-1"
        />
        <span>
          Animate on a green screen
          <span className="block text-xs text-slate-500">
            Video models can&apos;t output transparency. Clips are made on flat
            green, then keyed out locally (needs ffmpeg), which also lets you
            put them on any exact colour.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-2">
        <span>Key colour</span>
        <input
          type="color"
          value={p.keyColor}
          onChange={(e) => save({ keyColor: e.target.value })}
          className="h-7 w-10 cursor-pointer rounded border"
        />
        <span className="text-xs text-slate-500">
          {p.keyColor} — keep green unless your subject contains green.
        </span>
      </div>
      <div>
        <div className="mb-1">Default export background</div>
        <div className="flex flex-wrap items-center gap-2">
          <Swatch
            color={null}
            selected={p.background.mode === "transparent"}
            onClick={() => save({ background: { mode: "transparent" } })}
            title="Transparent"
          />
          {savedColors.map((c) => (
            <Swatch
              key={c}
              color={c}
              selected={
                p.background.mode === "color" && p.background.color === c
              }
              onClick={() => save({ background: { mode: "color", color: c } })}
            />
          ))}
          <input
            type="color"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border"
            aria-label="Custom colour"
          />
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="w-24 rounded border border-slate-300 px-1 py-0.5 font-mono text-xs"
            aria-label="Hex colour"
          />
          <Btn
            onClick={async () => {
              await patch("/api/settings", {
                savedColors: [...new Set([...savedColors, custom])],
              });
              await save({ background: { mode: "color", color: custom } });
              refresh();
            }}
          >
            Save &amp; use
          </Btn>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Saved colours (like your brand pink) are available everywhere you
          export.
        </p>
      </div>
    </fieldset>
  );
}
