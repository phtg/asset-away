declare global {
  var __assetAwaySessionKey: string | undefined;
}

/**
 * The OpenRouter key comes from OPENROUTER_API_KEY, or from a session-only key
 * held in this server process's memory (lost on restart). It is never written
 * to disk, returned to the browser, put in a URL or logged.
 */
export function getApiKey(): string | null {
  return (
    globalThis.__assetAwaySessionKey || process.env.OPENROUTER_API_KEY || null
  );
}

export function keySource(): "session" | "env" | "none" {
  if (globalThis.__assetAwaySessionKey) return "session";
  if (process.env.OPENROUTER_API_KEY) return "env";
  return "none";
}

export function setSessionKey(key: string | null): void {
  globalThis.__assetAwaySessionKey = key?.trim() || undefined;
}
