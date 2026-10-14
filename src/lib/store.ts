import fs from "node:fs";
import path from "node:path";
import { newId } from "./id";
import { newItem, newProject, inspectImage } from "./items";
import {
  DEFAULT_SETTINGS,
  type AppState,
  type FileInfo,
  type Item,
  type Settings,
} from "./types";

function emptyState(): AppState {
  return {
    version: 2,
    settings: {
      ...DEFAULT_SETTINGS,
      savedColors: [...DEFAULT_SETTINGS.savedColors],
    },
    projects: [],
    batches: [],
    items: [],
  };
}

type V1 = {
  settings?: Record<string, unknown>;
  images?: {
    id: string;
    name: string;
    file: string;
    mediaType: string;
    bytes: number;
    createdAt: string;
  }[];
  jobs?: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Carry v1 images and finished videos over so nothing paid for is lost. */
export function migrateV1(raw: V1, imagesDir?: string): AppState {
  const s = emptyState();
  const old = raw.settings ?? {};
  const project = newProject("Imported", "mascot", {
    animationRules:
      typeof old.sharedInstructions === "string" && old.sharedInstructions
        ? old.sharedInstructions
        : newProject("x").animationRules,
    greenScreen: false,
  });
  s.projects.push(project);
  s.settings = {
    ...s.settings,
    concurrency: typeof old.concurrency === "number" ? old.concurrency : 2,
    mock: old.mock === true,
    videoModel: (old.videoModel as string) ?? null,
    imageModel: (old.stillModel as string) ?? null,
    helperModel: (old.helperModel as string) ?? null,
    activeProjectId: project.id,
  };
  const idMap = new Map<string, string>();
  let order = 0;
  for (const img of raw.images ?? []) {
    let dims = {
      width: null as number | null,
      height: null as number | null,
      hasAlpha: false,
    };
    if (imagesDir) {
      try {
        dims = inspectImage(fs.readFileSync(path.join(imagesDir, img.file)));
      } catch {
        /* file missing: keep nulls */
      }
    }
    const it = newItem({
      projectId: project.id,
      kind: "image",
      name: img.name,
      origin: "upload",
      order: ++order,
      verdict: "kept",
      include: false,
      state: "completed",
      createdAt: img.createdAt,
      file: {
        file: img.file,
        mediaType: img.mediaType,
        bytes: img.bytes,
        format: img.file.split(".").pop() ?? "png",
        contentType: null,
        ...dims,
      },
    });
    idMap.set(img.id, it.id);
    s.items.push(it);
  }
  const anchor = old.defaultImageId
    ? idMap.get(old.defaultImageId as string)
    : null;
  project.anchorId = anchor ?? s.items[0]?.id ?? null;
  for (const j of raw.jobs ?? []) {
    if (j.state !== "completed" || !j.output) continue;
    const src =
      idMap.get(j.startImageId ?? (old.defaultImageId as string)) ?? null;
    const file: FileInfo = {
      file: j.output.file,
      mediaType: j.output.contentType ?? "video/mp4",
      bytes: j.output.bytes,
      format: j.output.format,
      contentType: j.output.contentType ?? null,
      width: null,
      height: null,
      hasAlpha: false,
    };
    s.items.push(
      newItem({
        projectId: project.id,
        kind: "clip",
        name: j.name,
        prompt: j.actionPrompt ?? "",
        order: ++order,
        verdict: "kept",
        include: false,
        state: "completed",
        sourceId: src,
        duration: j.run?.duration ?? null,
        resolution: j.run?.resolution ?? null,
        aspectRatio: j.run?.aspectRatio ?? null,
        providerJobId: j.providerJobId ?? null,
        costUsd: j.costUsd ?? null,
        createdAt: j.createdAt,
        queuedAt: j.queuedAt ?? null,
        submittedAt: j.submittedAt ?? null,
        completedAt: j.completedAt ?? null,
        file,
      }),
    );
  }
  void newId;
  return s;
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
  readonly outputsDir: string;
  readonly exportsDir: string;
  private file: string;
  private state: AppState;
  private writing: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.dir = path.resolve(dir);
    this.imagesDir = path.join(this.dir, "images");
    this.outputsDir = path.join(this.dir, "outputs");
    this.exportsDir = path.join(this.dir, "exports");
    for (const d of [this.imagesDir, this.outputsDir, this.exportsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    this.file = path.join(this.dir, "state.json");
    this.state = this.load();
  }

  private load(): AppState {
    if (!fs.existsSync(this.file)) return emptyState();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw.version === 1 || (!raw.version && raw.jobs)) {
        fs.copyFileSync(this.file, `${this.file}.v1.bak`);
        const migrated = migrateV1(raw, this.imagesDir);
        fs.writeFileSync(this.file, JSON.stringify(migrated, null, 2));
        return migrated;
      }
      const base = emptyState();
      return {
        version: 2,
        settings: { ...base.settings, ...(raw.settings as Settings) },
        projects: Array.isArray(raw.projects) ? raw.projects : [],
        batches: Array.isArray(raw.batches) ? raw.batches : [],
        items: Array.isArray(raw.items) ? raw.items : [],
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

  item(id: string): Item | undefined {
    return this.state.items.find((j) => j.id === id);
  }

  dirFor(item: Item): string {
    return item.kind === "clip" ? this.outputsDir : this.imagesDir;
  }

  filePath(item: Item): string | null {
    return item.file ? path.join(this.dirFor(item), item.file.file) : null;
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
