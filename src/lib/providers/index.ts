import type { Settings } from "../types";
import { mock } from "./mock";
import { openrouter } from "./openrouter";
import type { Provider } from "./types";

export function isMock(settings: Settings): boolean {
  return settings.mock || process.env.MOCK_MODE === "1";
}

export function getProvider(settings: Settings): Provider {
  return isMock(settings) ? mock : openrouter;
}
