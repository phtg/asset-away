import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionKey } from "@/lib/keys";
import { submitVideo } from "@/lib/providers/openrouter";
import { ProviderError } from "@/lib/retry";

const req = {
  model: "x-ai/grok-imagine-video-1.5-lite",
  prompt: "p",
  firstFrameDataUrl: "data:image/png;base64,AAAA",
  duration: 4,
  resolution: "480p",
  aspectRatio: null,
  seed: null,
  generateAudio: false as boolean | null,
};

const ok = () =>
  new Response(
    JSON.stringify({
      id: "gen-vid-1",
      polling_url: "/api/v1/videos/gen-vid-1",
      status: "pending",
    }),
    {
      status: 202,
    },
  );
const err = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), { status });

let calls: Record<string, unknown>[];
function stub(...responses: Response[]) {
  calls = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return queue.shift() ?? ok();
    }),
  );
}

beforeEach(() => setSessionKey("sk-or-test-key-12345678"));
afterEach(() => {
  vi.unstubAllGlobals();
  setSessionKey(null);
});

describe("silent video requests", () => {
  it("sends generate_audio:false", async () => {
    stub(ok());
    await submitVideo(req);
    expect(calls).toHaveLength(1);
    expect(calls[0].generate_audio).toBe(false);
  });

  it("omits the flag when the planner did not set it", async () => {
    stub(ok());
    await submitVideo({ ...req, generateAudio: null });
    expect("generate_audio" in calls[0]).toBe(false);
  });

  it("re-sends once without the flag if the provider refuses that flag itself (400 names it)", async () => {
    stub(err(400, "Unknown parameter: generate_audio"), ok());
    const h = await submitVideo(req);
    expect(h.id).toBe("gen-vid-1");
    expect(calls).toHaveLength(2);
    expect("generate_audio" in calls[1]).toBe(false);
  });

  it("does NOT retry other rejections", async () => {
    stub(err(400, "Unsupported resolution 480p"), ok());
    await expect(submitVideo(req)).rejects.toMatchObject({
      kind: "rejected",
      status: 400,
    });
    expect(calls).toHaveLength(1);
  });

  it("never retries an ambiguous failure, even one mentioning the flag", async () => {
    stub(err(500, "generate_audio failed upstream"), ok());
    await expect(submitVideo(req)).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(1);
  });
});
