import { getProvider } from "./providers";
import { mock } from "./providers/mock";
import { openrouter } from "./providers/openrouter";
import { Runner } from "./runner";
import { getStore } from "./store";

export function getRunner(): Runner {
  if (!globalThis.__assetAwayRunner) {
    const store = getStore();
    const runner = new Runner({
      store,
      providerById: (id) => (id === "mock" ? mock : openrouter),
      pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 15_000,
    });
    globalThis.__assetAwayRunner = runner;
    void runner.recover(); // settle interrupted jobs, resume polling
  }
  return globalThis.__assetAwayRunner;
}

export function currentProvider() {
  return getProvider(getStore().get().settings);
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function fail(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

import { ffmpegStatus } from "./ffmpeg";
import { newProject } from "./items";
import type { Project } from "./types";

/** Make sure there is always an active project to work in. */
export async function ensureProject(): Promise<Project> {
  const store = getStore();
  const s = store.get();
  let active = s.projects.find((p) => p.id === s.settings.activeProjectId);
  if (!active) {
    active = s.projects[0];
    if (!active) {
      active = newProject("My first project", "mascot");
      s.projects.push(active);
    }
    s.settings.activeProjectId = active.id;
    await store.flush();
  }
  return active;
}

export { ffmpegStatus };
export { newId } from "./id";
