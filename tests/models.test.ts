import { describe, expect, it } from "vitest";
import {
  defaultResolution,
  estimateVideoCost,
  nearestDuration,
  resolveSettings,
  validateSettings,
} from "@/lib/models";
import { redact } from "@/lib/redact";
import { sniffImage, sniffVideo } from "@/lib/sniff";
import type { VideoModel } from "@/lib/types";

const base: VideoModel = {
  id: "x/y",
  name: "y",
  supportedDurations: [5, 8],
  supportedResolutions: ["720p", "1080p"],
  supportedAspectRatios: ["16:9"],
  supportedFrameImages: ["first_frame"],
  generateAudio: true,
  seed: false,
  pricingSkus: null,
};

describe("defaults", () => {
  it("picks the nearest duration to 4s", () => {
    expect(nearestDuration([4, 6, 8])).toBe(4);
    expect(nearestDuration([5, 8])).toBe(5);
    expect(nearestDuration([2, 6])).toBe(2); // tie -> shorter
    expect(nearestDuration(null)).toBeNull();
  });
  it("prefers 480p, else the lowest", () => {
    expect(defaultResolution(["1080p", "480p"])).toBe("480p");
    expect(defaultResolution(["1080p", "720p"])).toBe("720p");
    expect(defaultResolution(["2K"])).toBe("2K");
  });
  it("always asks for silence, unless the model cannot make audio at all", () => {
    const j = {
      duration: null,
      resolution: null,
      aspectRatio: null,
      seed: null,
    };
    expect(
      resolveSettings(j, { ...base, generateAudio: true }).generateAudio,
    ).toBe(false);
    expect(
      resolveSettings(j, { ...base, generateAudio: null }).generateAudio,
    ).toBe(false);
    expect(
      resolveSettings(j, { ...base, generateAudio: false }).generateAudio,
    ).toBeNull();
  });
  it("only requests a seed when the model supports it", () => {
    const r = resolveSettings(
      { duration: null, resolution: null, aspectRatio: null, seed: 3 },
      base,
    );
    expect(r).toMatchObject({
      duration: 5,
      resolution: "720p",
      seed: null,
      generateAudio: false,
    });
  });
});

describe("validateSettings", () => {
  const job = {
    duration: null,
    resolution: null,
    aspectRatio: null,
    seed: null,
  };
  it("accepts defaults", () => expect(validateSettings(job, base)).toEqual([]));
  it("flags unsupported values", () => {
    const errs = validateSettings(
      { duration: 4, resolution: "480p", aspectRatio: "1:1", seed: 1 },
      base,
    );
    expect(errs).toHaveLength(4);
  });
  it("rejects models without first-frame support", () => {
    expect(
      validateSettings(job, { ...base, supportedFrameImages: null })[0],
    ).toMatch(/starting image/);
  });
});

describe("estimateVideoCost", () => {
  const s = { duration: 4, resolution: "480p", audio: false };
  it("uses per-second resolution SKUs", () => {
    const m = { ...base, pricingSkus: { duration_seconds_480p: "0.05" } };
    expect(estimateVideoCost(m, s)).toBe(0.2);
  });
  it("converts cents SKUs", () => {
    const m = {
      ...base,
      pricingSkus: {
        cents_per_video_output_second_480p: "2",
        cents_per_image_input: "1",
      },
    };
    expect(estimateVideoCost(m, s)).toBe(0.09);
  });
  it("prefers the without-audio SKU when audio is off", () => {
    const m = {
      ...base,
      pricingSkus: {
        duration_seconds_without_audio: "0.1",
        duration_seconds_with_audio: "0.4",
      },
    };
    expect(estimateVideoCost(m, s)).toBe(0.4);
  });
  it("returns null (Cost unavailable) for token pricing or missing data", () => {
    expect(
      estimateVideoCost(
        { ...base, pricingSkus: { video_tokens: "0.000007" } },
        s,
      ),
    ).toBeNull();
    expect(estimateVideoCost({ ...base, pricingSkus: null }, s)).toBeNull();
    expect(
      estimateVideoCost(
        { ...base, pricingSkus: { duration_seconds: "0.1" } },
        { ...s, duration: null },
      ),
    ).toBeNull();
  });
});

describe("redact", () => {
  it("removes keys, bearer tokens, and inline image data", () => {
    const out = redact(
      `bad key sk-or-v1-abcdef123456 and Bearer abcdefgh12345678 and mysecretvalue ${"data:image/png;base64," + "A".repeat(100)}`,
      ["mysecretvalue"],
    );
    expect(out).not.toContain("abcdef123456");
    expect(out).not.toContain("abcdefgh12345678");
    expect(out).not.toContain("mysecretvalue");
    expect(out).not.toContain("AAAAAAAA");
  });
});

describe("sniff", () => {
  it("detects images by magic bytes, not names", () => {
    expect(
      sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))?.ext,
    ).toBe("png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe(
      "jpg",
    );
    expect(sniffImage(new TextEncoder().encode("GIF89a......."))).toBeNull();
  });
  it("reports the real video container", () => {
    const mp4 = new Uint8Array(16);
    mp4.set(new TextEncoder().encode("ftypisom"), 4);
    expect(sniffVideo(mp4)).toBe("mp4");
    const mov = new Uint8Array(16);
    mov.set(new TextEncoder().encode("ftypqt  "), 4);
    expect(sniffVideo(mov)).toBe("mov");
    expect(sniffVideo(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe(
      "webm",
    );
    expect(sniffVideo(new Uint8Array(32))).toBe("unknown");
  });
});
