import fs from "node:fs";
import path from "node:path";
import { getApiKey } from "./keys";
import { slugify } from "./parse";
import type { Provider } from "./providers/types";
import { redact } from "./redact";
import { ProviderError, realSleep, withBackoff, type Sleep } from "./retry";
import { sniffImage, sniffVideo, toDataUrl } from "./sniff";
import type { Store } from "./store";
import type { Job, RunSnapshot } from "./types";

export interface RunnerOptions {
  store: Store;
  providerById: (id: RunSnapshot["provider"]) => Provider;
  sleep?: Sleep;
  pollIntervalMs?: number;
  backoffBaseMs?: number;
}

const MAX_IDENTITY_REFS = 3;
const now = () => new Date().toISOString();

function errMsg(e: unknown): string {
  const key = getApiKey();
  return redact(e instanceof Error ? e.message : String(e), key ? [key] : []);
}

/**
 * In-process job queue for a single-user local app.
 *
 * Safety rules (they exist to avoid duplicate charges):
 *  - State is persisted BEFORE every paid provider call.
 *  - A submission is never retried automatically. Ambiguous outcomes become
 *    `submission_uncertain` and wait for a human decision.
 *  - Only reads (polling, downloads) are retried, with backoff.
 *  - The provider job id is persisted the moment it is known, so polling
 *    resumes after a refresh or restart.
 */
export class Runner {
  private running = new Set<string>();
  private sleep: Sleep;
  private pollIntervalMs: number;
  private backoffBaseMs: number;

  constructor(private opts: RunnerOptions) {
    this.sleep = opts.sleep ?? realSleep;
    this.pollIntervalMs = opts.pollIntervalMs ?? 15_000;
    this.backoffBaseMs = opts.backoffBaseMs ?? 2_000;
  }

  private get store() {
    return this.opts.store;
  }

  private patch(id: string, p: Partial<Job>): Promise<void> {
    return this.store.update((s) => {
      const j = s.jobs.find((x) => x.id === id);
      if (j) Object.assign(j, p);
    });
  }

  /** Call once at startup: settle jobs whose in-flight call was interrupted. */
  async recover(): Promise<void> {
    await this.store.update((s) => {
      for (const j of s.jobs) {
        if (j.state === "preparing_image") {
          j.state = "submission_uncertain";
          j.uncertainStage = "still";
          j.error =
            "The app stopped while the starting image was being generated. It may have been charged; check your OpenRouter activity.";
        } else if (j.state === "submitting") {
          j.state = "submission_uncertain";
          j.uncertainStage = "video";
          j.error =
            "The app stopped while submitting this video. It may have been accepted and charged; check your OpenRouter activity before retrying.";
        } else if (
          (j.state === "generating" || j.state === "downloading") &&
          !j.providerJobId
        ) {
          j.state = "submission_uncertain";
          j.uncertainStage = "video";
          j.error =
            "Lost track of the provider job id. It may have been charged.";
        }
      }
    });
    this.tick();
  }

  // ---- commands (called by API routes) ----

  async queue(entries: { id: string; snapshot: RunSnapshot }[]) {
    const queued: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    await this.store.update((s) => {
      for (const { id, snapshot } of entries) {
        const j = s.jobs.find((x) => x.id === id);
        if (!j) skipped.push({ id, reason: "Unknown job" });
        else if (j.state !== "draft")
          skipped.push({ id, reason: `Already ${j.state}` });
        else if (!j.include) skipped.push({ id, reason: "Not included" });
        else {
          Object.assign(j, {
            state: "queued",
            run: snapshot,
            queuedAt: now(),
            error: null,
            pollError: null,
            uncertainStage: null,
          } satisfies Partial<Job>);
          queued.push(id);
        }
      }
    });
    this.tick();
    return { queued, skipped };
  }

  /** Explicitly re-run a failed job (the caller must have confirmed). */
  async retry(id: string, snapshot: RunSnapshot): Promise<void> {
    await this.store.update((s) => {
      const j = s.jobs.find((x) => x.id === id);
      if (!j || j.state !== "failed")
        throw new Error("Only failed jobs can be retried.");
      j.error = null;
      j.pollError = null;
      j.uncertainStage = null;
      if (j.providerJobId && j.providerStatus === "completed" && !j.output) {
        // Generation finished and was paid for; only the download failed.
        j.state = "downloading";
      } else {
        Object.assign(j, {
          state: "queued",
          run: snapshot,
          queuedAt: now(),
          providerJobId: null,
          pollingUrl: null,
          providerStatus: null,
          output: null,
          costUsd: null,
        } satisfies Partial<Job>);
      }
    });
    this.tick();
  }

  /** The user checked their provider activity: nothing was started. */
  async markNotSubmitted(id: string): Promise<void> {
    await this.store.update((s) => {
      const j = s.jobs.find((x) => x.id === id);
      if (!j || j.state !== "submission_uncertain") {
        throw new Error("Job is not in an uncertain state.");
      }
      j.state = "failed";
      j.error =
        "Marked as not submitted. Retrying will submit again; if the earlier attempt actually went through you may be charged twice.";
    });
  }

  async approveStill(id: string): Promise<void> {
    await this.store.update((s) => {
      const j = s.jobs.find((x) => x.id === id);
      if (!j || j.state !== "awaiting_image_approval" || !j.still) {
        throw new Error("No starting image is awaiting approval.");
      }
      j.still.approved = true;
      j.state = "queued";
    });
    this.tick();
  }

  async discardStill(id: string): Promise<void> {
    const file = await this.store.update((s) => {
      const j = s.jobs.find((x) => x.id === id);
      if (!j || j.state !== "awaiting_image_approval" || !j.still) {
        throw new Error("No starting image is awaiting approval.");
      }
      const f = j.still.file;
      j.still = null;
      j.run = null;
      j.state = "draft";
      return f;
    });
    fs.rmSync(path.join(this.store.stillsDir, file), { force: true });
  }

  /** Stop queued jobs. Submitted jobs cannot be cancelled with this provider. */
  async stopQueued(): Promise<number> {
    return this.store.update((s) => {
      let n = 0;
      for (const j of s.jobs) {
        if (j.state === "queued") {
          j.state = "draft";
          j.run = null;
          n++;
        }
      }
      return n;
    });
  }

  // ---- scheduling ----

  tick(): void {
    const s = this.store.get();
    // Resume watching jobs that are already at the provider (always allowed).
    for (const j of s.jobs) {
      if (
        (j.state === "generating" || j.state === "downloading") &&
        j.providerJobId &&
        !this.running.has(j.id)
      ) {
        this.launch(j.id);
      }
    }
    const queued = s.jobs
      .filter((j) => j.state === "queued" && !this.running.has(j.id))
      .sort((a, b) => a.order - b.order);
    for (const j of queued) {
      if (this.running.size >= Math.max(1, s.settings.concurrency)) break;
      this.launch(j.id);
    }
  }

  get activeCount(): number {
    return this.running.size;
  }

  /** Resolves when nothing is running (used by tests). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private launch(id: string): void {
    this.running.add(id);
    this.run(id)
      .catch((e) => this.settleUnexpected(id, e))
      .finally(() => {
        this.running.delete(id);
        this.tick();
      });
  }

  private async settleUnexpected(id: string, e: unknown): Promise<void> {
    const j = this.store.job(id);
    if (!j) return;
    const m = errMsg(e);
    if (j.state === "submitting" || j.state === "preparing_image") {
      await this.uncertain(id, j.state === "submitting" ? "video" : "still", m);
    } else {
      await this.patch(id, { state: "failed", error: m });
    }
  }

  private fail(id: string, message: string) {
    return this.patch(id, { state: "failed", error: message });
  }

  private uncertain(id: string, stage: "still" | "video", message: string) {
    return this.patch(id, {
      state: "submission_uncertain",
      uncertainStage: stage,
      error: `${message} The request may have been accepted and charged. It will NOT be retried automatically; check your provider activity.`,
    });
  }

  // ---- the work ----

  private async run(id: string): Promise<void> {
    let job = this.store.job(id);
    if (!job) return;

    if (job.state === "queued") {
      const snap = job.run;
      if (!snap) return void (await this.fail(id, "Missing run settings."));
      const provider = this.opts.providerById(snap.provider);

      if (job.mode === "prepare" && !job.still) {
        const advanced = await this.stageStill(id, provider, snap);
        if (!advanced) return;
      }
      if (!(await this.stageVideo(id, provider, snap))) return;
      job = this.store.job(id)!;
    }

    if (job.state === "generating") {
      const provider = this.opts.providerById(
        job.run?.provider ?? "openrouter",
      );
      if (!(await this.pollUntilDone(id, provider))) return;
      job = this.store.job(id)!;
    }
    if (job.state === "downloading") {
      const provider = this.opts.providerById(
        job.run?.provider ?? "openrouter",
      );
      await this.download(id, provider);
    }
  }

  private startImage(
    job: Job,
  ): { mediaType: string; bytes: Uint8Array; name: string } | null {
    const s = this.store.get();
    if (job.still?.approved) {
      const f = path.join(this.store.stillsDir, job.still.file);
      if (!fs.existsSync(f)) return null;
      return {
        mediaType: job.still.mediaType,
        bytes: new Uint8Array(fs.readFileSync(f)),
        name: "approved prepared still",
      };
    }
    const img = s.images.find(
      (i) => i.id === (job.startImageId ?? s.settings.defaultImageId),
    );
    if (!img) return null;
    const f = path.join(this.store.imagesDir, img.file);
    if (!fs.existsSync(f)) return null;
    return {
      mediaType: img.mediaType,
      bytes: new Uint8Array(fs.readFileSync(f)),
      name: img.name,
    };
  }

  /** Returns true when the job should continue straight on to the video. */
  private async stageStill(
    id: string,
    provider: Provider,
    snap: RunSnapshot,
  ): Promise<boolean> {
    const job = this.store.job(id)!;
    const s = this.store.get();
    const base = this.startImage(job);
    if (!base || !snap.stillModel || !snap.fullStillPrompt) {
      await this.fail(id, "Starting image or image model is missing.");
      return false;
    }
    const baseId = job.startImageId ?? s.settings.defaultImageId;
    const refs = s.images
      .filter((i) => i.identityRef && i.id !== baseId)
      .slice(0, MAX_IDENTITY_REFS)
      .flatMap((i) => {
        const f = path.join(this.store.imagesDir, i.file);
        return fs.existsSync(f)
          ? [
              {
                mediaType: i.mediaType,
                bytes: new Uint8Array(fs.readFileSync(f)),
              },
            ]
          : [];
      });

    await this.patch(id, { state: "preparing_image", error: null }); // persisted first
    try {
      const out = await provider.generateStill({
        model: snap.stillModel,
        prompt: snap.fullStillPrompt,
        images: [{ mediaType: base.mediaType, bytes: base.bytes }, ...refs],
        aspectRatio: snap.aspectRatio,
      });
      const type = sniffImage(out.bytes);
      if (!type)
        throw new ProviderError(
          "Provider returned an unsupported image.",
          "rejected",
        );
      const file = `${id}-${Date.now()}.${type.ext}`;
      fs.writeFileSync(path.join(this.store.stillsDir, file), out.bytes);
      const auto = this.store.get().settings.autoApproveStills;
      await this.patch(id, {
        still: {
          file,
          mediaType: type.mediaType,
          approved: auto,
          costUsd: out.costUsd,
          createdAt: now(),
        },
        state: auto ? "queued" : "awaiting_image_approval",
      });
      return auto;
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "rejected") {
        await this.fail(id, errMsg(e));
      } else {
        await this.uncertain(id, "still", errMsg(e));
      }
      return false;
    }
  }

  private async stageVideo(
    id: string,
    provider: Provider,
    snap: RunSnapshot,
  ): Promise<boolean> {
    const job = this.store.job(id)!;
    const img = this.startImage(job);
    if (!img) {
      await this.fail(id, "The starting image is missing.");
      return false;
    }
    // Persist BEFORE the paid call, so a crash leaves a visible "submitting".
    await this.patch(id, {
      state: "submitting",
      submittedAt: now(),
      error: null,
    });
    try {
      const handle = await provider.submitVideo({
        model: snap.videoModel,
        prompt: snap.fullVideoPrompt,
        firstFrameDataUrl: toDataUrl(img.mediaType, img.bytes),
        duration: snap.duration,
        resolution: snap.resolution,
        aspectRatio: snap.aspectRatio,
        seed: snap.seed,
        generateAudio: snap.generateAudio,
      });
      await this.patch(id, {
        providerJobId: handle.id,
        pollingUrl: handle.pollingUrl,
        providerStatus: "pending",
        state: "generating",
      });
      return true;
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "rejected") {
        await this.fail(id, errMsg(e));
      } else {
        await this.uncertain(id, "video", errMsg(e));
      }
      return false;
    }
  }

  private async pollUntilDone(
    id: string,
    provider: Provider,
  ): Promise<boolean> {
    let consecutiveErrors = 0;
    for (;;) {
      const job = this.store.job(id);
      if (!job || !job.providerJobId) return false;
      const handle = {
        id: job.providerJobId,
        pollingUrl: job.pollingUrl ?? "",
      };
      try {
        const r = await withBackoff(() => provider.pollVideo(handle), {
          tries: 4,
          baseMs: this.backoffBaseMs,
          sleep: this.sleep,
        });
        consecutiveErrors = 0;
        if (job.pollError) await this.patch(id, { pollError: null });
        await this.patch(id, { providerStatus: r.status });
        if (r.status === "completed") {
          await this.patch(id, {
            state: "downloading",
            costUsd: r.costUsd ?? job.costUsd,
          });
          return true;
        }
        if (
          r.status === "failed" ||
          r.status === "cancelled" ||
          r.status === "expired"
        ) {
          await this.patch(id, {
            state: "failed",
            error: r.error || `Provider reported the job as ${r.status}.`,
            costUsd: r.costUsd ?? null,
          });
          return false;
        }
        await this.sleep(this.pollIntervalMs);
      } catch (e) {
        consecutiveErrors++;
        const pe = e instanceof ProviderError ? e : null;
        await this.patch(id, { pollError: errMsg(e) });
        if (pe?.status === 404 && consecutiveErrors >= 30) {
          await this.fail(id, "The provider no longer knows this job (404).");
          return false;
        }
        // Keep trying: the job may still be running (and billing) remotely.
        const wait = Math.min(
          this.pollIntervalMs * 2 ** Math.min(consecutiveErrors, 4),
          120_000,
        );
        await this.sleep(wait);
      }
    }
  }

  private async download(id: string, provider: Provider): Promise<void> {
    const job = this.store.job(id)!;
    const handle = { id: job.providerJobId!, pollingUrl: job.pollingUrl ?? "" };
    try {
      const { bytes, contentType } = await withBackoff(
        () => provider.downloadVideo(handle),
        {
          tries: 4,
          baseMs: this.backoffBaseMs,
          sleep: this.sleep,
        },
      );
      const format = sniffVideo(bytes);
      const ext = format === "unknown" ? "bin" : format;
      const tmp = path.join(this.store.outputsDir, `${id}.tmp`);
      fs.writeFileSync(tmp, bytes);
      await this.store.update((s) => {
        const j = s.jobs.find((x) => x.id === id)!;
        const slug = slugify(j.name);
        const re = new RegExp(`^${slug}-(\\d+)\\.`);
        let n = 0;
        for (const o of s.jobs) {
          const m = o.output && re.exec(o.output.file);
          if (m) n = Math.max(n, Number(m[1]));
        }
        const file = `${slug}-${String(n + 1).padStart(2, "0")}.${ext}`;
        fs.renameSync(tmp, path.join(this.store.outputsDir, file));
        j.output = { file, bytes: bytes.length, format, contentType };
        j.state = "completed";
        j.completedAt = now();
        j.error =
          format === "unknown"
            ? "Downloaded, but the file is not a recognised MP4/WebM. It was not renamed."
            : null;
      });
    } catch (e) {
      await this.fail(
        id,
        `Download failed: ${errMsg(e)} The video is ready at the provider; use "Retry download" (free).`,
      );
    }
  }
}

declare global {
  var __assetAwayRunner: Runner | undefined;
}
