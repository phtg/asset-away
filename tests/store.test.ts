import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASPECTS,
  extractJson,
  parseAnimations,
  parsePoses,
} from "@/lib/helpers";
import { inspectImage, normalizeHex } from "@/lib/items";
import { Store } from "@/lib/store";

describe("v1 -> v2 migration", () => {
  it("carries images and finished videos into an Imported project and backs up", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-mig-"));
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({
        version: 1,
        settings: {
          sharedInstructions: "my rules",
          defaultImageId: "i1",
          videoModel: "v/x",
          stillModel: "i/y",
          helperModel: "c/z",
          concurrency: 3,
          mock: false,
        },
        images: [
          {
            id: "i1",
            name: "Robot",
            file: "i1.png",
            mediaType: "image/png",
            bytes: 10,
            identityRef: true,
            createdAt: "2026-10-13T00:00:00Z",
          },
        ],
        jobs: [
          {
            id: "j1",
            name: "Wave",
            actionPrompt: "waves",
            startImageId: "i1",
            state: "completed",
            output: {
              file: "wave-01.mp4",
              bytes: 99,
              format: "mp4",
              contentType: "video/mp4",
            },
            costUsd: 0.09,
            createdAt: "2026-10-13T00:00:00Z",
            run: { duration: 4, resolution: "480p", aspectRatio: null },
          },
          {
            id: "j2",
            name: "Draft",
            actionPrompt: "x",
            state: "draft",
            output: null,
          },
        ],
      }),
    );
    const s = new Store(dir).get();
    expect(s.version).toBe(2);
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].animationRules).toBe("my rules");
    expect(s.projects[0].greenScreen).toBe(false);
    const img = s.items.find((i) => i.kind === "image")!;
    const clip = s.items.find((i) => i.kind === "clip")!;
    expect(s.items).toHaveLength(2); // the draft is dropped, finished work is kept
    expect(img).toMatchObject({
      verdict: "kept",
      state: "completed",
      origin: "upload",
    });
    expect(s.projects[0].anchorId).toBe(img.id);
    expect(clip).toMatchObject({
      name: "Wave",
      sourceId: img.id,
      costUsd: 0.09,
      verdict: "kept",
    });
    expect(clip.file!.file).toBe("wave-01.mp4");
    expect(s.settings).toMatchObject({
      videoModel: "v/x",
      imageModel: "i/y",
      helperModel: "c/z",
      concurrency: 3,
    });
    expect(fs.existsSync(path.join(dir, "state.json.v1.bak"))).toBe(true);
    // idempotent: reopening reads the migrated v2 file
    expect(new Store(dir).get().items).toHaveLength(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("helpers", () => {
  it("extracts JSON from fenced/chatty replies", () => {
    expect(extractJson('Sure!\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(extractJson('{"items":[1]}')).toEqual({ items: [1] });
    expect(() => extractJson("no json here")).toThrow();
  });
  it("parses poses and drops incomplete ones", () => {
    const out = parsePoses(
      '[{"name":"Wave","prompt":"waves"},{"name":"","prompt":"x"},{"name":"NoPrompt"}]',
    );
    expect(out).toEqual([{ name: "Wave", prompt: "waves" }]);
  });
  it("validates animation suggestions (duration, aspect, loop)", () => {
    const [a, b] = parseAnimations(
      JSON.stringify([
        {
          name: "Wave",
          prompt: "waves",
          duration: 3.4,
          aspectRatio: "1:1",
          loop: true,
          reason: "short",
        },
        {
          name: "Odd",
          prompt: "x",
          duration: 999,
          aspectRatio: "7:5",
          loop: "yes",
        },
      ]),
    );
    expect(a).toMatchObject({ duration: 3, aspectRatio: "1:1", loop: true });
    expect(b).toMatchObject({ duration: 15, aspectRatio: null, loop: null });
    expect(ASPECTS).toContain("16:9");
  });
});

describe("colours and image headers", () => {
  it("normalizes hex colours", () => {
    expect(normalizeHex("E60167")).toBe("#e60167");
    expect(normalizeHex(" #E60167 ")).toBe("#e60167");
    expect(normalizeHex("#fff")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });
  it("reads PNG size and alpha", () => {
    const png = (colorType: number) => {
      const b = new Uint8Array(40);
      b.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], 0);
      new DataView(b.buffer).setUint32(16, 300);
      new DataView(b.buffer).setUint32(20, 200);
      b[25] = colorType;
      return b;
    };
    expect(inspectImage(png(6))).toEqual({
      width: 300,
      height: 200,
      hasAlpha: true,
    });
    expect(inspectImage(png(2)).hasAlpha).toBe(false);
  });
});
