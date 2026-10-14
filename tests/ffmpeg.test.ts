import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compositeImage,
  ffmpegStatus,
  keyImage,
  padToAspect,
  paddedSize,
  probe,
  sampleCorner,
  videoToGif,
  videoToMp4OnColor,
  videoToWebmAlpha,
} from "@/lib/ffmpeg";

describe("paddedSize", () => {
  it("adds margin to reach the aspect ratio without cropping", () => {
    expect(paddedSize(1000, 1000, "16:9")).toEqual({
      width: 1778,
      height: 1000,
    });
    expect(paddedSize(1600, 900, "1:1")).toEqual({ width: 1600, height: 1600 });
    expect(paddedSize(800, 800, "1:1")).toEqual({ width: 800, height: 800 });
  });
});

const have = await ffmpegStatus().then((s) => s.available);
const d = have ? describe : describe.skip;

d("ffmpeg pipeline (real ffmpeg)", () => {
  let dir: string;
  const f = (n: string) => path.join(dir, n);
  const ff = (...a: string[]) =>
    execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
  /** Read RGBA of pixel (x,y) from an image/gif/webm frame via ffmpeg. */
  const px = (file: string, x: number, y: number, dec: string[] = []) => [
    ...execFileSync("ffmpeg", [
      "-v",
      "error",
      ...dec,
      "-i",
      file,
      "-vf",
      `format=rgba,crop=1:1:${x}:${y}`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-",
    ]),
  ];

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-ff-"));
    // 160x120 pure green screen with a solid red square in the middle, 2s
    ff(
      "-f",
      "lavfi",
      "-i",
      "color=c=0x00ff00:s=160x120:r=15:d=2",
      "-f",
      "lavfi",
      "-i",
      "color=c=0xcc2222:s=40x40:r=15:d=2",
      "-filter_complex",
      "[0:v][1:v]overlay=60:40,format=yuv420p",
      "-c:v",
      "libx264",
      f("green.mp4"),
    );
    ff(
      "-f",
      "lavfi",
      "-i",
      "color=c=0x00ff00:s=160x120",
      "-i",
      f("green.mp4"),
      "-filter_complex",
      "[1:v]select=eq(n\\,0)[v]",
      "-map",
      "[v]",
      "-frames:v",
      "1",
      f("green.png"),
    );
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("samples the background colour from the corner", async () => {
    const c = await sampleCorner(f("green.mp4"));
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(200);
    expect(r).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it("keys an image to a transparent PNG", async () => {
    await keyImage(f("green.png"), f("keyed.png"), { keyColor: "#00ff00" });
    expect(px(f("keyed.png"), 5, 5)[3]).toBe(0); // corner transparent
    const c = px(f("keyed.png"), 80, 60);
    expect(c[3]).toBe(255); // square opaque
    expect(c[0]).toBeGreaterThan(150); // still red
  });

  it("composites a transparent PNG onto an exact brand colour", async () => {
    await compositeImage(f("keyed.png"), f("pink.png"), "#e60167");
    expect(px(f("pink.png"), 5, 5).slice(0, 3)).toEqual([0xe6, 0x01, 0x67]);
    expect(px(f("pink.png"), 80, 60)[0]).toBeGreaterThan(150);
  });

  it("pads to an aspect ratio with the key colour", async () => {
    await padToAspect(f("green.png"), f("wide.png"), "16:9", "#00ff00");
    const m = await probe(f("wide.png"));
    expect(m.width / m.height).toBeCloseTo(16 / 9, 1);
  });

  it("renders an MP4 on the brand colour with exact background pixels", async () => {
    await videoToMp4OnColor(f("green.mp4"), f("pink.mp4"), {
      keyColor: "#00ff00",
      background: "#e60167",
    });
    const c = px(f("pink.mp4"), 5, 5);
    // H.264 4:2:0 cannot be bit-exact; stay within a few levels
    expect(Math.abs(c[0] - 0xe6)).toBeLessThan(5);
    expect(Math.abs(c[1] - 0x01)).toBeLessThan(5);
    expect(Math.abs(c[2] - 0x67)).toBeLessThan(5);
    expect((await probe(f("pink.mp4"))).width).toBe(160);
  });

  it("makes a GIF with real transparency", async () => {
    await videoToGif(f("green.mp4"), f("t.gif"), { keyColor: "#00ff00" });
    expect(px(f("t.gif"), 5, 5)[3]).toBe(0);
    expect(px(f("t.gif"), 80, 60)[3]).toBe(255);
  });

  it("makes a VP9 WebM with an alpha channel", async () => {
    await videoToWebmAlpha(f("green.mp4"), f("t.webm"), {
      keyColor: "#00ff00",
    });
    // the native vp9 decoder drops alpha; libvpx-vp9 decodes it
    expect(px(f("t.webm"), 5, 5, ["-c:v", "libvpx-vp9"])[3]).toBeLessThan(10);
    expect(px(f("t.webm"), 80, 60, ["-c:v", "libvpx-vp9"])[3]).toBeGreaterThan(
      245,
    );
  });
});
