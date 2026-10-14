import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ffmpegStatus } from "@/lib/ffmpeg";
import { newItem } from "@/lib/items";
import type { Provider, VideoSubmitRequest } from "@/lib/providers/types";
import { ProviderError } from "@/lib/retry";
import { Runner } from "@/lib/runner";
import { Store } from "@/lib/store";
import type { Item, RunSnapshot } from "@/lib/types";
import { newProject } from "@/lib/items";

const haveFfmpeg = await ffmpegStatus().then((s) => s.available);

/** Minimal PNG header (8x8, RGBA) - enough for sniffing, not decodable. */
const PNG = (() => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], 0);
  b.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  new DataView(b.buffer).setUint32(16, 8);
  new DataView(b.buffer).setUint32(20, 8);
  b[24] = 8;
  b[25] = 6;
  return b;
})();
const MP4 = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode("ftypisom"), 4);
  return b;
})();

const clipSnap: RunSnapshot = {
  provider: "mock",
  kind: "clip",
  model: "m/v",
  fullPrompt: "act\n\nrules",
  refIds: ["img1"],
  refNames: ["Robot"],
  background: "none",
  startFrame: "image",
  duration: 4,
  resolution: "480p",
  aspectRatio: null,
  seed: null,
  generateAudio: null,
  loopMode: "none",
  keyColor: "#00ff00",
  estimatedCostUsd: null,
};
const imageSnap: RunSnapshot = {
  ...clipSnap,
  kind: "image",
  model: "m/img",
  fullPrompt: "a pose",
  background: "native-alpha",
  startFrame: null,
  loopMode: "none",
};

interface Fake extends Provider {
  submits: VideoSubmitRequest[];
  images: number;
  inFlight: number;
  maxInFlight: number;
  onSubmit?: (req: VideoSubmitRequest) => void | Promise<void>;
  pollFn?: (id: string) => ReturnType<Provider["pollVideo"]>;
  downloadFn?: () => ReturnType<Provider["downloadVideo"]>;
  imageFn?: () => ReturnType<Provider["generateImage"]>;
}

function fake(): Fake {
  const f: Fake = {
    id: "mock",
    label: "fake",
    submits: [],
    images: 0,
    inFlight: 0,
    maxInFlight: 0,
    async listVideoModels() {
      return [];
    },
    async listImageModels() {
      return [];
    },
    async listChatModels() {
      return [];
    },
    async submitVideo(req) {
      f.submits.push(req);
      await f.onSubmit?.(req);
      f.inFlight++;
      f.maxInFlight = Math.max(f.maxInFlight, f.inFlight);
      const id = `prov-${f.submits.length}`;
      return { id, pollingUrl: `/x/${id}` };
    },
    async pollVideo(h) {
      if (f.pollFn) return f.pollFn(h.id);
      await new Promise((r) => setTimeout(r, 5));
      return { status: "completed", costUsd: 0.1 };
    },
    async downloadVideo() {
      f.inFlight--;
      if (f.downloadFn) return f.downloadFn();
      return { bytes: MP4, contentType: "video/mp4" };
    },
    async generateImage() {
      f.images++;
      if (f.imageFn) return f.imageFn();
      return { bytes: PNG, mediaType: "image/png", costUsd: 0.02 };
    },
    async chat() {
      return "";
    },
  };
  return f;
}

let dir: string;
let store: Store;
let prov: Fake;

function runner(p: Provider = prov) {
  return new Runner({
    store,
    providerById: () => p,
    sleep: async () => {},
    pollIntervalMs: 0,
    backoffBaseMs: 0,
  });
}

async function seed(
  n: number,
  over: (i: number) => Partial<Item> = () => ({}),
) {
  const project = newProject("P");
  const src = newItem({
    projectId: project.id,
    kind: "image",
    origin: "upload",
    name: "Robot",
    verdict: "kept",
    state: "completed",
    include: false,
    file: {
      file: "img1.png",
      mediaType: "image/png",
      bytes: PNG.length,
      format: "png",
      width: 8,
      height: 8,
      hasAlpha: false,
      contentType: null,
    },
  });
  src.id = "img1";
  fs.writeFileSync(path.join(store.imagesDir, "img1.png"), PNG);
  await store.update((s) => {
    s.projects.push(project);
    s.settings.concurrency = 2;
    s.items.push(src);
    for (let i = 1; i <= n; i++) {
      const c = newItem({
        projectId: project.id,
        kind: "clip",
        name: `Anim ${i}`,
        prompt: "act",
        sourceId: "img1",
        order: i,
        ...over(i),
      });
      c.id = `job${i}`;
      s.items.push(c);
    }
  });
}

const all = (ids: string[], snapshot = clipSnap) =>
  ids.map((id) => ({ id, snapshot }));
const states = () =>
  store
    .get()
    .items.filter((i) => i.kind === "clip")
    .map((j) => j.state);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-away-test-"));
  store = new Store(dir);
  prov = fake();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("clip queue", () => {
  it("never exceeds the configured concurrency and finishes every clip", async () => {
    await seed(6);
    const r = runner();
    await r.queue(all(["job1", "job2", "job3", "job4", "job5", "job6"]));
    await r.idle();
    expect(prov.maxInFlight).toBe(2);
    expect(states().every((s) => s === "completed")).toBe(true);
    expect(prov.submits).toHaveLength(6);
  });

  it("a failed clip does not stop the rest of the batch", async () => {
    await seed(4);
    prov.onSubmit = () => {
      if (prov.submits.length === 2)
        throw new ProviderError("400: nope", "rejected", 400);
    };
    const r = runner();
    await r.queue(all(["job1", "job2", "job3", "job4"]));
    await r.idle();
    expect(states().filter((s) => s === "completed")).toHaveLength(3);
    const failed = store.get().items.find((j) => j.state === "failed")!;
    expect(failed.error).toContain("nope");
    expect(failed.providerJobId).toBeNull();
  });

  it("ignores double-queueing: each item is submitted once", async () => {
    await seed(1);
    const r = runner();
    const [a, b] = await Promise.all([
      r.queue(all(["job1"])),
      r.queue(all(["job1"])),
    ]);
    await r.idle();
    expect(a.queued.length + b.queued.length).toBe(1);
    expect(prov.submits).toHaveLength(1);
  });

  it("stopQueued returns waiting items to draft but leaves submitted ones alone", async () => {
    await seed(3);
    await store.update((s) => (s.settings.concurrency = 1));
    let release!: () => void;
    prov.onSubmit = () => new Promise<void>((res) => (release = res));
    const r = runner();
    await r.queue(all(["job1", "job2", "job3"]));
    await new Promise((res) => setTimeout(res, 20));
    expect(await r.stopQueued()).toBe(2);
    release();
    await r.idle();
    expect(states()).toEqual(["completed", "draft", "draft"]);
    expect(prov.submits).toHaveLength(1);
  });

  it("names files source-animation-NN and reports the real format", async () => {
    await seed(2, () => ({ name: "Thinking" }));
    const r = runner();
    await r.queue(all(["job1", "job2"]));
    await r.idle();
    const files = store
      .get()
      .items.filter((i) => i.kind === "clip")
      .map((j) => j.file!.file)
      .sort();
    expect(files).toEqual(["robot-thinking-01.mp4", "robot-thinking-02.mp4"]);
    expect(store.get().items.find((i) => i.id === "job1")!.file!.format).toBe(
      "mp4",
    );
    expect(
      fs.existsSync(path.join(store.outputsDir, "robot-thinking-01.mp4")),
    ).toBe(true);
  });

  it("does not rename a non-MP4 download", async () => {
    await seed(1);
    prov.downloadFn = async () => ({
      bytes: new Uint8Array(32),
      contentType: "video/mp4",
    });
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    const j = store.item("job1")!;
    expect(j.file!.format).toBe("unknown");
    expect(j.file!.file.endsWith(".bin")).toBe(true);
  });

  it("sends the same image as first and last frame for last-frame loops", async () => {
    await seed(1, () => ({ loop: true }));
    const r = runner();
    await r.queue(all(["job1"], { ...clipSnap, loopMode: "last-frame" }));
    await r.idle();
    expect(prov.submits[0].lastFrameDataUrl).toBe(
      prov.submits[0].firstFrameDataUrl,
    );
    prov.submits.length = 0;
  });

  it("sends no last frame when not looping", async () => {
    await seed(1);
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(prov.submits[0].lastFrameDataUrl).toBeNull();
  });
});

describe("submission safety", () => {
  it("persists 'submitting' to disk BEFORE calling the provider", async () => {
    await seed(1);
    let onDisk = "";
    prov.onSubmit = () => {
      onDisk = JSON.parse(
        fs.readFileSync(path.join(dir, "state.json"), "utf8"),
      ).items.find((i: Item) => i.id === "job1").state;
    };
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(onDisk).toBe("submitting");
  });

  it("persists the provider job id before polling", async () => {
    await seed(1);
    let idOnDisk: string | null = null;
    prov.pollFn = async () => {
      idOnDisk = JSON.parse(
        fs.readFileSync(path.join(dir, "state.json"), "utf8"),
      ).items.find((i: Item) => i.id === "job1").providerJobId;
      return { status: "completed" };
    };
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(idOnDisk).toBe("prov-1");
  });

  it("an ambiguous submission becomes 'submission uncertain' and is never retried", async () => {
    await seed(1);
    prov.onSubmit = () => {
      throw new ProviderError("No response (timeout).", "uncertain");
    };
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(states()).toEqual(["submission_uncertain"]);
    expect(store.item("job1")!.uncertainStage).toBe("video");
    r.tick();
    const r2 = runner();
    await r2.recover();
    await r2.idle();
    expect(prov.submits).toHaveLength(1);
    expect(states()).toEqual(["submission_uncertain"]);
  });

  it("a crash mid-submit is recovered as uncertain, not resubmitted", async () => {
    await seed(1, () => ({ state: "submitting", run: clipSnap }));
    const r = runner();
    await r.recover();
    await r.idle();
    expect(states()).toEqual(["submission_uncertain"]);
    expect(prov.submits).toHaveLength(0);
  });

  it("retry needs a failed item; uncertain items must be cleared by the user first", async () => {
    await seed(1, () => ({
      state: "submission_uncertain",
      uncertainStage: "video",
    }));
    const r = runner();
    await expect(r.retry("job1", clipSnap)).rejects.toThrow(/failed/);
    await r.markNotSubmitted("job1");
    expect(states()).toEqual(["failed"]);
    await r.retry("job1", clipSnap);
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.submits).toHaveLength(1);
  });
});

describe("persistence and resume", () => {
  it("reloads state from disk and resumes polling without resubmitting", async () => {
    await seed(1, () => ({
      state: "generating",
      run: clipSnap,
      providerJobId: "prov-existing",
      pollingUrl: "/x/prov-existing",
      providerStatus: "in_progress",
    }));
    store = new Store(dir); // simulates an app restart
    prov.inFlight = 1;
    const r = runner();
    await r.recover();
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.submits).toHaveLength(0);
  });

  it("keeps polling through transient errors instead of failing", async () => {
    await seed(1);
    let n = 0;
    prov.pollFn = async () => {
      if (++n <= 6) throw new ProviderError("Network error", "transient");
      return { status: "completed" };
    };
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(n).toBe(7);
  });

  it("retries a flaky download but never the submission", async () => {
    await seed(1);
    let n = 0;
    prov.downloadFn = async () => {
      if (++n < 3) throw new ProviderError("502", "transient", 502);
      return { bytes: MP4, contentType: "video/mp4" };
    };
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.submits).toHaveLength(1);
  });

  it("a permanently failing download can be retried for free", async () => {
    await seed(1);
    prov.downloadFn = async () => {
      throw new ProviderError("403", "fatal", 403);
    };
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(states()).toEqual(["failed"]);
    expect(store.item("job1")!.error).toMatch(/Retry download/);
    prov.downloadFn = undefined;
    await r.retry("job1", clipSnap);
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.submits).toHaveLength(1);
  });

  it("surfaces provider-reported failures with the error message", async () => {
    await seed(1);
    prov.pollFn = async () => ({
      status: "failed",
      error: "Content policy violation",
    });
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(store.item("job1")).toMatchObject({
      state: "failed",
      error: "Content policy violation",
    });
  });
});

describe("image generation", () => {
  async function seedImage(over: Partial<Item> = {}) {
    await seed(0);
    await store.update((s) => {
      const it = newItem({
        projectId: s.projects[0].id,
        kind: "image",
        name: "Pointing",
        prompt: "points",
        order: 9,
        ...over,
      });
      it.id = "gen1";
      s.items.push(it);
    });
  }

  it("saves the image, marks it for review, and records cost", async () => {
    await seedImage();
    const r = runner();
    await r.queue([{ id: "gen1", snapshot: imageSnap }]);
    await r.idle();
    const it = store.item("gen1")!;
    expect(it.state).toBe("completed");
    expect(it.verdict).toBe("pending");
    expect(it.costUsd).toBe(0.02);
    expect(it.file!.hasAlpha).toBe(true);
    expect(fs.existsSync(path.join(store.imagesDir, it.file!.file))).toBe(true);
  });

  it("flags an opaque result when transparency was requested", async () => {
    await seedImage();
    prov.imageFn = async () => ({
      bytes: Uint8Array.from([...PNG.slice(0, 25), 2, ...PNG.slice(26)]), // colour type 2 = no alpha
      mediaType: "image/png",
      costUsd: 0,
    });
    const r = runner();
    await r.queue([{ id: "gen1", snapshot: imageSnap }]);
    await r.idle();
    expect(store.item("gen1")!.error).toMatch(/opaque/);
    expect(store.item("gen1")!.state).toBe("completed");
  });

  it("an uncertain image request is not retried automatically", async () => {
    await seedImage();
    prov.imageFn = async () => {
      throw new ProviderError("timeout", "uncertain");
    };
    const r = runner();
    await r.queue([{ id: "gen1", snapshot: imageSnap }]);
    await r.idle();
    expect(store.item("gen1")!.state).toBe("submission_uncertain");
    expect(store.item("gen1")!.uncertainStage).toBe("image");
    r.tick();
    await r.idle();
    expect(prov.images).toBe(1);
  });

  it("a rejected image request fails without charging", async () => {
    await seedImage();
    prov.imageFn = async () => {
      throw new ProviderError("400: bad prompt", "rejected", 400);
    };
    const r = runner();
    await r.queue([{ id: "gen1", snapshot: imageSnap }]);
    await r.idle();
    expect(store.item("gen1")).toMatchObject({ state: "failed", file: null });
  });

  it("recovers an interrupted image request as uncertain", async () => {
    await seedImage({ state: "generating", run: imageSnap });
    const r = runner();
    await r.recover();
    expect(store.item("gen1")!.state).toBe("submission_uncertain");
    expect(prov.images).toBe(0);
  });

  it.skipIf(!haveFfmpeg)(
    "removes a green background locally and keeps a transparent PNG",
    async () => {
      await seedImage();
      const green = path.join(dir, "g.png");
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x00ff00:s=64x64",
        "-f",
        "lavfi",
        "-i",
        "color=c=0xcc2222:s=20x20",
        "-filter_complex",
        "[0:v][1:v]overlay=22:22",
        "-frames:v",
        "1",
        green,
      ]);
      prov.imageFn = async () => ({
        bytes: new Uint8Array(fs.readFileSync(green)),
        mediaType: "image/png",
        costUsd: 0,
      });
      const r = runner();
      await r.queue([
        { id: "gen1", snapshot: { ...imageSnap, background: "chroma" } },
      ]);
      await r.idle();
      const it = store.item("gen1")!;
      expect(it.state).toBe("completed");
      expect(it.file!.hasAlpha).toBe(true);
      expect(it.error).toBeNull();
    },
  );

  it("keeps the paid image even if keying fails", async () => {
    await seedImage();
    prov.imageFn = async () => ({
      bytes: PNG,
      mediaType: "image/png",
      costUsd: 0,
    }); // 8x8 stub: ffmpeg may reject
    const r = runner();
    await r.queue([
      {
        id: "gen1",
        snapshot: { ...imageSnap, background: "chroma", keyColor: "#00ff00" },
      },
    ]);
    await r.idle();
    const it = store.item("gen1")!;
    expect(it.state).toBe("completed");
    expect(it.file).not.toBeNull();
  });
});
