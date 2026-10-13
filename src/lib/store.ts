import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  type AppState,
  type Job,
  type Settings,
} from "./types";

function emptyState(): AppState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    images: [],
    jobs: [],
  };
}

/**
 * Single-user JSON store. The in-memory state is the source of truth; every
 * `update` is applied synchronously (so concurrent requests cannot interleave
 * mid-change) and then flushed atomically (write temp file + rename).
 * No API keys are ever put in this state.
 */
export class Store {
  readonly dir: string;
  readonly imagesDir: string;
  readonly stillsDir: string;
  readonly outputsDir: string;
  private file: string;
  private state: AppState;
  private writing: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.dir = path.resolve(dir);
    this.imagesDir = path.join(this.dir, "images");
    this.stillsDir = path.join(this.dir, "stills");
    this.outputsDir = path.join(this.dir, "outputs");
    this.file = path.join(this.dir, "state.json");
    for (const d of [this.imagesDir, this.stillsDir, this.outputsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    this.state = this.load();
  }

  private load(): AppState {
    if (!fs.existsSync(this.file)) return emptyState();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const base = emptyState();
      return {
        version: 1,
        settings: { ...base.settings, ...(raw.settings as Settings) },
        images: Array.isArray(raw.images) ? raw.images : [],
        jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
      };
    } catch {
      // Keep the unreadable file for inspection instead of overwriting it.
      const bad = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, bad);
      console.error(`state.json was unreadable; moved to ${bad}`);
      return emptyState();
    }
  }

  get(): AppState {
    return this.state;
  }

  job(id: string): Job | undefined {
    return this.state.jobs.find((j) => j.id === id);
  }

  /** Apply a change synchronously, then wait until it is on disk. */
  async update<T>(fn: (s: AppState) => T): Promise<T> {
    const result = fn(this.state);
    await this.flush();
    return result;
  }

  flush(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing.then(() => {
      const tmp = `${this.file}.tmp`;
      return fs.promises
        .writeFile(tmp, snapshot)
        .then(() => fs.promises.rename(tmp, this.file));
    });
    return this.writing;
  }
}

declare global {
  var __assetAwayStore: Store | undefined;
}

export function getStore(): Store {
  // globalThis keeps one instance across dev-server module reloads.
  globalThis.__assetAwayStore ??= new Store(
    process.env.DATA_DIR || path.join(process.cwd(), "data"),
  );
  return globalThis.__assetAwayStore;
}
