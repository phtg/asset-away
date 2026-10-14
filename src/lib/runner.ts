import fs from "node:fs";
import path from "node:path";
import { compositeImage, keyImage, padToAspect } from "./ffmpeg";
import { inspectImage } from "./items";
import { getApiKey } from "./keys";
import { slugify } from "./parse";
import type { Provider } from "./providers/types";
import { redact } from "./redact";
import { ProviderError, realSleep, withBackoff, type Sleep } from "./retry";
import { sniffImage, sniffVideo, toDataUrl } from "./sniff";
import type { Store } from "./store";
import type { FileInfo, Item, RunSnapshot } from "./types";

export interface RunnerOptions {
  store: Store;
  providerById: (id: RunSnapshot["provider"]) => Provider;
  sleep?: Sleep;
  pollIntervalMs?: number;
  backoffBaseMs?: number;
}

const now = () => new Date().toISOString();

function errMsg(e: unknown): string {
  const key = getApiKey();
  return redact(e instanceof Error ? e.message : String(e), key ? [key] : []);
}

/**
 * In-process queue for images and clips (single-user local app).
 *
 * Safety rules (they exist to avoid duplicate charges):
 *  - State is persisted BEFORE every paid provider call.
 *  - A paid request is never retried automatically. Ambiguous outcomes become
 *    `submission_uncertain` and wait for a human decision.
 *  - Only reads (polling, downloads) are retried, with backoff.
 *  - A video's provider job id is persisted the moment it is known, so
 *    polling resumes after a refresh or restart.
 *  - A paid result is always saved, even if local post-processing fails.
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

  private patch(id: string, p: Partial<Item>): Promise<void> {
    return this.store.update((s) => {
      const j = s.items.find((x) => x.id === id);
      if (j) Object.assign(j, p);
    });
  }

  /** Call once at startup: settle interrupted items, resume polling. */
  async recover(): Promise<void> {
    await this.store.update((s) => {
      for (const j of s.items) {
        if (j.kind === "image" && j.state === "generating") {
          j.state = "submission_uncertain";
          j.uncertainStage = "image";
          j.error =
            "The app stopped while this image was being generated. It may have been charged; check your OpenRouter activity.";
        } else if (j.kind === "clip" && j.state === "submitting") {
          j.state = "submission_uncertain";
          j.uncertainStage = "video";
          j.error =
            "The app stopped while submitting this video. It may have been accepted and charged; check your OpenRouter activity before retrying.";
        } else if (
          j.kind === "clip" &&
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
        const j = s.items.find((x) => x.id === id);
        if (!j) skipped.push({ id, reason: "Unknown item" });
        else if (j.state !== "draft")
          skipped.push({ id, reason: `Already ${j.state}` });
        else {
          Object.assign(j, {
            state: "queued",
            run: snapshot,
            queuedAt: now(),
            error: null,
            pollError: null,
            uncertainStage: null,
          } satisfies Partial<Item>);
          queued.push(id);
        }
      }
    });
    this.tick();
    return { queued, skipped };
  }

  /** Explicitly re-run a failed item (the caller must have confirmed). */
  async retry(id: string, snapshot: RunSnapshot): Promise<void> {
    await this.store.update((s) => {
      const j = s.items.find((x) => x.id === id);
      if (!j || j.state !== "failed")
        throw new Error("Only failed items can be retried.");
      j.error = null;
      j.pollError = null;
      j.uncertainStage = null;
      if (
        j.kind === "clip" &&
        j.providerJobId &&
        j.providerStatus === "completed" &&
        !j.file
      ) {
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
          file: null,
          costUsd: null,
        } satisfies Partial<Item>);
      }
    });
    this.tick();
  }

  /** The user checked their provider activity: nothing was started. */
  async markNotSubmitted(id: string): Promise<void> {
    await this.store.update((s) => {
      const j = s.items.find((x) => x.id === id);
      if (!j || j.state !== "submission_uncertain") {
        throw new Error("Item is not in an uncertain state.");
      }
      j.state = "failed";
      j.error =
        "Marked as not submitted. Retrying will submit again; if the earlier attempt actually went through you may be charged twice.";
    });
  }

  /** Stop queued items. Submitted requests cannot be cancelled. */
  async stopQueued(): Promise<number> {
    return this.store.update((s) => {
      let n = 0;
      for (const j of s.items) {
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
    // Resume watching videos that are already at the provider (always allowed).
    for (const j of s.items) {
      if (
        j.kind === "clip" &&
        (j.state === "generating" || j.state === "downloading") &&
        j.providerJobId &&
        !this.running.has(j.id)
      ) {
        this.launch(j.id);
      }
    }
    const queued = s.items
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
    const j = this.store.item(id);
    if (!j) return;
    const m = errMsg(e);
    if (j.state === "submitting") await this.uncertain(id, "video", m);
    else if (j.kind === "image" && j.state === "generating")
      await this.uncertain(id, "image", m);
    else await this.patch(id, { state: "failed", error: m });
  }

  private fail(id: string, message: string) {
    return this.patch(id, { state: "failed", error: message });
  }

  private uncertain(id: string, stage: "image" | "video", message: string) {
    return this.patch(id, {
      state: "submission_uncertain",
      uncertainStage: stage,
      error: `${message} The request may have been accepted and charged. It will NOT be retried automatically; check your provider activity.`,
    });
  }

  // ---- the work ----

  private async run(id: string): Promise<void> {
    let item = this.store.item(id);
    if (!item) return;
    if (item.kind === "image") {
      if (item.state === "queued") await this.runImage(id);
      return;
    }

    if (item.state === "queued") {
      const snap = item.run;
      if (!snap) return void (await this.fail(id, "Missing run settings."));
      const provider = this.opts.providerById(snap.provider);
      if (!(await this.submitClip(id, provider, snap))) return;
      item = this.store.item(id)!;
    }
    const provider = this.opts.providerById(item.run?.provider ?? "openrouter");
    if (item.state === "generating") {
      if (!(await this.pollUntilDone(id, provider))) return;
      item = this.store.item(id)!;
    }
    if (item.state === "downloading") await this.download(id, provider);
  }

  private readFile(it: Item | undefined) {
    const p = it && this.store.filePath(it);
    if (!it || !p || !fs.existsSync(p)) return null;
    return {
      path: p,
      mediaType: it.file!.mediaType,
      bytes: new Uint8Array(fs.readFileSync(p)),
    };
  }

  // ----- images -----

  private async runImage(id: string): Promise<void> {
    const item = this.store.item(id)!;
    const snap = item.run;
    if (!snap) return void (await this.fail(id, "Missing run settings."));
    const provider = this.opts.providerById(snap.provider);
    const refs = snap.refIds.flatMap((rid) => {
      const f = this.readFile(this.store.item(rid));
      return f ? [{ mediaType: f.mediaType, bytes: f.bytes }] : [];
    });
    if (snap.refIds.length && refs.length !== snap.refIds.length) {
      return void (await this.fail(id, "A reference image file is missing."));
    }

    await this.patch(id, {
      state: "generating",
      error: null,
      submittedAt: now(),
    }); // persisted first
    let out;
    try {
      out = await provider.generateImage({
        model: snap.model,
        prompt: snap.fullPrompt,
        images: refs,
        aspectRatio: snap.aspectRatio,
        background: snap.background === "native-alpha" ? "transparent" : null,
      });
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "rejected")
        await this.fail(id, errMsg(e));
      else await this.uncertain(id, "image", errMsg(e));
      return;
    }

    // From here on the image is paid for: always keep it.
    const type = sniffImage(out.bytes);
    if (!type) {
      return void (await this.fail(
        id,
        "The provider returned an unsupported image (kept nothing).",
      ));
    }
    let bytes = out.bytes;
    let ext: string = type.ext;
    let mediaType: string = type.mediaType;
    let note: string | null = null;
    const base = `${id}-${Date.now()}`;
    if (snap.background === "chroma") {
      const rawPath = path.join(
        this.store.imagesDir,
        `${base}.raw.${type.ext}`,
      );
      const keyedPath = path.join(this.store.imagesDir, `${base}.png`);
      fs.writeFileSync(rawPath, bytes);
      try {
        await keyImage(rawPath, keyedPath, { keyColor: snap.keyColor });
        bytes = new Uint8Array(fs.readFileSync(keyedPath));
        ext = "png";
        mediaType = "image/png";
        fs.rmSync(rawPath, { force: true });
      } catch (e) {
        note = `Saved the original, but removing the green background failed: ${errMsg(e)}`;
        fs.renameSync(
          rawPath,
          path.join(this.store.imagesDir, `${base}.${type.ext}`),
        );
      }
    }
    const fileName = `${base}.${ext}`;
    const full = path.join(this.store.imagesDir, fileName);
    if (!fs.existsSync(full)) fs.writeFileSync(full, bytes);
    const info = inspectImage(bytes);
    if (snap.background === "native-alpha" && !info.hasAlpha) {
      note =
        "The model returned an opaque image although transparency was requested.";
    }
    const file: FileInfo = {
      file: fileName,
      mediaType,
      bytes: bytes.length,
      format: ext,
      contentType: null,
      ...info,
    };
    await this.patch(id, {
      file,
      state: "completed",
      verdict: "pending",
      costUsd: out.costUsd,
      completedAt: now(),
      error: note,
    });
  }

  // ----- clips -----

  /** Build the first frame: the green-screen plate, padded to the aspect. */
  private async startFrame(item: Item, snap: RunSnapshot) {
    const src = this.store.item(item.sourceId ?? "");
    const target =
      snap.startFrame === "plate" ? this.store.item(src?.plateId ?? "") : src;
    const f = this.readFile(target);
    if (!f || !target) throw new Error("The starting image file is missing.");
    const tmp = path.join(this.store.exportsDir, `${item.id}-start.png`);
    try {
      if (snap.aspectRatio) {
        await padToAspect(f.path, tmp, snap.aspectRatio, snap.keyColor);
        return {
          mediaType: "image/png",
          bytes: new Uint8Array(fs.readFileSync(tmp)),
        };
      }
      if (snap.startFrame === "image" && target.file!.hasAlpha) {
        await compositeImage(f.path, tmp, "#ffffff");
        return {
          mediaType: "image/png",
          bytes: new Uint8Array(fs.readFileSync(tmp)),
        };
      }
      return { mediaType: f.mediaType, bytes: f.bytes };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  private async submitClip(
    id: string,
    provider: Provider,
    snap: RunSnapshot,
  ): Promise<boolean> {
    const item = this.store.item(id)!;
    let frame;
    try {
      frame = await this.startFrame(item, snap); // before any paid call
    } catch (e) {
      await this.fail(id, errMsg(e));
      return false;
    }
    const url = toDataUrl(frame.mediaType, frame.bytes);
    // Persist BEFORE the paid call, so a crash leaves a visible "submitting".
    await this.patch(id, {
      state: "submitting",
      submittedAt: now(),
      error: null,
    });
    try {
      const handle = await provider.submitVideo({
        model: snap.model,
        prompt: snap.fullPrompt,
        firstFrameDataUrl: url,
        lastFrameDataUrl: snap.loopMode === "last-frame" ? url : null,
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
      if (e instanceof ProviderError && e.kind === "rejected")
        await this.fail(id, errMsg(e));
      else await this.uncertain(id, "video", errMsg(e));
      return false;
    }
  }

  private async pollUntilDone(
    id: string,
    provider: Provider,
  ): Promise<boolean> {
    let consecutiveErrors = 0;
    for (;;) {
      const job = this.store.item(id);
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
    const job = this.store.item(id)!;
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
        const j = s.items.find((x) => x.id === id)!;
        const src = s.items.find((x) => x.id === j.sourceId);
        const slug = `${slugify(src?.name ?? "clip")}-${slugify(j.name)}`;
        const re = new RegExp(
          `^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.`,
        );
        let n = 0;
        for (const o of s.items) {
          const m = o.kind === "clip" && o.file && re.exec(o.file.file);
          if (m) n = Math.max(n, Number(m[1]));
        }
        const file = `${slug}-${String(n + 1).padStart(2, "0")}.${ext}`;
        fs.renameSync(tmp, path.join(this.store.outputsDir, file));
        j.file = {
          file,
          mediaType: contentType ?? "video/mp4",
          bytes: bytes.length,
          format,
          width: null,
          height: null,
          hasAlpha: false,
          contentType,
        };
        j.state = "completed";
        j.verdict = "pending";
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
