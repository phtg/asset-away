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

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
