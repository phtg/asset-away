"use client";

import { useRef, useState } from "react";
import type { ImageRecord } from "@/lib/types";
import { api, patch } from "./api";

export function Gallery({
  images,
  defaultImageId,
  maxUploadMb,
  refresh,
}: {
  images: ImageRecord[];
  defaultImageId: string | null;
  maxUploadMb: number;
  refresh: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const upload = async (files: FileList | File[]) => {
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    setMsg("Uploading…");
    try {
      const r = await api<{ rejected: { name: string; reason: string }[] }>(
        "/api/images",
        {
          method: "POST",
          body: form,
        },
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">2. Reference images</h2>
      <p className="mt-1 text-xs text-slate-600">
        <b>Starting frame</b> = the one image the video begins from (the video
        API takes a single first frame). <b>Identity reference</b> = extra views
        used <i>only</i> when an image model prepares a starting image; they are
        never sent to the video model.
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
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={`mt-3 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm ${
          over ? "border-sky-500 bg-sky-50" : "border-slate-300 text-slate-500"
        }`}
      >
        Drop PNG, JPEG or WebP images here, or click to choose (max{" "}
        {maxUploadMb} MB each)
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

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((img) => (
          <div
            key={img.id}
            className={`rounded-lg border p-2 ${img.id === defaultImageId ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/images/${img.id}/file`}
              alt={img.name}
              className="aspect-square w-full rounded bg-slate-100 object-contain"
            />
            <input
              defaultValue={img.name}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== img.name) {
                  void patch(`/api/images/${img.id}`, {
                    name: e.target.value,
                  }).then(refresh);
                }
              }}
              className="mt-2 w-full rounded border border-slate-200 px-1 py-0.5 text-sm"
              aria-label="Image name"
            />
            <label className="mt-1 flex items-center gap-1 text-xs">
              <input
                type="radio"
                name="default-image"
                checked={img.id === defaultImageId}
                onChange={() =>
                  void patch("/api/settings", { defaultImageId: img.id }).then(
                    refresh,
                  )
                }
              />
              Default starting frame
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={img.identityRef}
                onChange={(e) =>
                  void patch(`/api/images/${img.id}`, {
                    identityRef: e.target.checked,
                  }).then(refresh)
                }
              />
              Identity reference
            </label>
            <button
              onClick={() => {
                if (confirm(`Remove "${img.name}"?`))
                  void api(`/api/images/${img.id}`, { method: "DELETE" }).then(
                    refresh,
                  );
              }}
              className="mt-1 text-xs text-rose-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
