import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Provider, VideoSubmitRequest } from "@/lib/providers/types";
import { ProviderError } from "@/lib/retry";
import { Runner } from "@/lib/runner";
import { Store } from "@/lib/store";
import type { Job, RunSnapshot } from "@/lib/types";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0,
]);
const MP4 = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode("ftypisom"), 4);
  return b;
})();

const snap: RunSnapshot = {
  provider: "mock",
  videoModel: "m/v",
  stillModel: "m/img",
  sharedInstructions: "shared",
  fullVideoPrompt: "act\n\nshared",
  fullStillPrompt: "still\n\nshared",
  startImageName: "robot",
  duration: 4,
  resolution: "480p",
  aspectRatio: null,
  seed: null,
  generateAudio: null,
  estimatedCostUsd: null,
};

function makeJob(i: number, over: Partial<Job> = {}): Job {
  return {
    id: `job${i}`,
    order: i,
    name: over.name ?? `Anim ${i}`,
    include: true,
    mode: "animate",
    startImageId: "img1",
    actionPrompt: "act",
    stillPrompt: "",
    duration: null,
    resolution: null,
    aspectRatio: null,
    seed: null,
    state: "draft",
    error: null,
    uncertainStage: null,
    run: null,
    still: null,
    providerJobId: null,
    pollingUrl: null,
    providerStatus: null,
    pollError: null,
    costUsd: null,
    output: null,
    createdAt: new Date().toISOString(),
    queuedAt: null,
    submittedAt: null,
    completedAt: null,
    ...over,
  };
}

interface Fake extends Provider {
  submits: VideoSubmitRequest[];
  inFlight: number;
  maxInFlight: number;
  stills: number;
  polls: number;
  onSubmit?: (req: VideoSubmitRequest) => void | Promise<void>;
  pollFn?: (id: string) => ReturnType<Provider["pollVideo"]>;
  downloadFn?: () => ReturnType<Provider["downloadVideo"]>;
}

function fake(): Fake {
  const f: Fake = {
    id: "mock",
    label: "fake",
    submits: [],
    inFlight: 0,
    maxInFlight: 0,
    stills: 0,
    polls: 0,
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
      f.polls++;
      if (f.pollFn) return f.pollFn(h.id);
      await new Promise((r) => setTimeout(r, 5));
      return { status: "completed", costUsd: 0.1 };
    },
    async downloadVideo() {
      f.inFlight--;
      if (f.downloadFn) return f.downloadFn();
      return { bytes: MP4, contentType: "video/mp4" };
    },
    async generateStill(req) {
      f.stills++;
      return {
        bytes: req.images[0].bytes,
        mediaType: "image/png",
        costUsd: 0.02,
      };
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

async function seed(n: number, over: (i: number) => Partial<Job> = () => ({})) {
  await store.update((s) => {
    s.images.push({
      id: "img1",
      name: "robot",
      file: "img1.png",
      mediaType: "image/png",
      bytes: PNG.length,
      identityRef: true,
      createdAt: "",
    });
    s.settings.concurrency = 2;
    for (let i = 1; i <= n; i++) s.jobs.push(makeJob(i, over(i)));
  });
  fs.writeFileSync(path.join(store.imagesDir, "img1.png"), PNG);
}

const all = (ids: string[]) => ids.map((id) => ({ id, snapshot: snap }));
const states = () => store.get().jobs.map((j) => j.state);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-away-test-"));
  store = new Store(dir);
  prov = fake();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("queue", () => {
  it("never exceeds the configured concurrency and finishes every job", async () => {
    await seed(6);
    const r = runner();
    await r.queue(all(store.get().jobs.map((j) => j.id)));
    await r.idle();
    expect(prov.maxInFlight).toBeLessThanOrEqual(2);
    expect(prov.maxInFlight).toBe(2);
    expect(states().every((s) => s === "completed")).toBe(true);
    expect(prov.submits).toHaveLength(6);
  });

  it("a failed job does not stop the rest of the batch", async () => {
    await seed(4);
    prov.onSubmit = (req) => {
      if (req.prompt && prov.submits.length === 2) {
        throw new ProviderError("400: nope", "rejected", 400);
      }
    };
    const r = runner();
    await r.queue(all(["job1", "job2", "job3", "job4"]));
    await r.idle();
    expect(states().filter((s) => s === "completed")).toHaveLength(3);
    const failed = store.get().jobs.find((j) => j.state === "failed")!;
    expect(failed.error).toContain("nope");
    expect(failed.providerJobId).toBeNull();
  });

  it("ignores double-queueing: each job is submitted once", async () => {
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

  it("stopQueued returns waiting jobs to draft but leaves submitted ones alone", async () => {
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

  it("numbers outputs per animation name and reports the real format", async () => {
    await seed(2, () => ({ name: "Thinking" }));
    const r = runner();
    await r.queue(all(["job1", "job2"]));
    await r.idle();
    const files = store
      .get()
      .jobs.map((j) => j.output!.file)
      .sort();
    expect(files).toEqual(["thinking-01.mp4", "thinking-02.mp4"]);
    expect(store.get().jobs[0].output!.format).toBe("mp4");
    expect(fs.existsSync(path.join(store.outputsDir, "thinking-01.mp4"))).toBe(
      true,
    );
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
    const j = store.get().jobs[0];
    expect(j.output!.format).toBe("unknown");
    expect(j.output!.file.endsWith(".bin")).toBe(true);
  });
});

describe("submission safety", () => {
  it("persists 'submitting' to disk BEFORE calling the provider", async () => {
    await seed(1);
    let onDisk = "";
    prov.onSubmit = () => {
      onDisk = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"))
        .jobs[0].state;
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
      ).jobs[0].providerJobId;
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
    expect(store.get().jobs[0].uncertainStage).toBe("video");
    // Ticking again, or restarting the app, must not resubmit.
    r.tick();
    const r2 = runner();
    await r2.recover();
    await r2.idle();
    expect(prov.submits).toHaveLength(1);
    expect(states()).toEqual(["submission_uncertain"]);
  });

  it("a crash mid-submit is recovered as uncertain, not resubmitted", async () => {
    await seed(1, () => ({ state: "submitting", run: snap }));
    const r = runner();
    await r.recover();
    await r.idle();
    expect(states()).toEqual(["submission_uncertain"]);
    expect(prov.submits).toHaveLength(0);
  });

  it("retry needs a failed job; uncertain jobs must be cleared by the user first", async () => {
    await seed(1, () => ({
      state: "submission_uncertain",
      uncertainStage: "video",
    }));
    const r = runner();
    await expect(r.retry("job1", snap)).rejects.toThrow(/failed/);
    await r.markNotSubmitted("job1");
    expect(states()).toEqual(["failed"]);
    await r.retry("job1", snap);
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.submits).toHaveLength(1);
  });
});

describe("persistence and resume", () => {
  it("reloads state from disk and resumes polling without resubmitting", async () => {
    await seed(1, () => ({
      state: "generating",
      run: snap,
      providerJobId: "prov-existing",
      pollingUrl: "/x/prov-existing",
      providerStatus: "in_progress",
    }));
    const reloaded = new Store(dir); // simulates an app restart
    expect(reloaded.get().jobs[0].providerJobId).toBe("prov-existing");
    store = reloaded;
    prov.inFlight = 1;
    const r = runner();
    await r.recover();
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.submits).toHaveLength(0);
  });

  it("keeps polling through transient errors instead of failing the job", async () => {
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
    expect(store.get().jobs[0].error).toMatch(/Retry download/);
    prov.downloadFn = undefined;
    await r.retry("job1", snap);
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
    expect(store.get().jobs[0]).toMatchObject({
      state: "failed",
      error: "Content policy violation",
    });
  });
});

describe("prepare starting image", () => {
  it("stops at 'awaiting approval' and spends nothing on video until approved", async () => {
    await seed(1, () => ({ mode: "prepare", stillPrompt: "add a mug" }));
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(states()).toEqual(["awaiting_image_approval"]);
    expect(prov.stills).toBe(1);
    expect(prov.submits).toHaveLength(0);

    await r.approveStill("job1");
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.submits).toHaveLength(1);
    expect(prov.submits[0].firstFrameDataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("chains straight to video only when auto-approve is explicitly enabled", async () => {
    await seed(1, () => ({ mode: "prepare", stillPrompt: "add a mug" }));
    await store.update((s) => (s.settings.autoApproveStills = true));
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(states()).toEqual(["completed"]);
    expect(prov.stills).toBe(1);
  });

  it("an uncertain still generation is not retried automatically", async () => {
    await seed(1, () => ({ mode: "prepare", stillPrompt: "x" }));
    prov.generateStill = async () => {
      prov.stills++;
      throw new ProviderError("timeout", "uncertain");
    };
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    expect(states()).toEqual(["submission_uncertain"]);
    expect(store.get().jobs[0].uncertainStage).toBe("still");
    r.tick();
    await r.idle();
    expect(prov.stills).toBe(1);
  });

  it("discarding a still returns the job to draft", async () => {
    await seed(1, () => ({ mode: "prepare", stillPrompt: "x" }));
    const r = runner();
    await r.queue(all(["job1"]));
    await r.idle();
    await r.discardStill("job1");
    expect(states()).toEqual(["draft"]);
    expect(store.get().jobs[0].still).toBeNull();
  });
});
