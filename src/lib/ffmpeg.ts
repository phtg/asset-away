import { spawn } from "node:child_process";

/**
 * Everything that needs ffmpeg lives here. Video models cannot output
 * transparency, so clips are generated on a flat key colour (default green)
 * and keyed out locally. Compositing onto an exact brand colour is done here
 * too, which is pixel-exact (an AI could only approximate the hex).
 */

export class FfmpegMissingError extends Error {
  constructor() {
    super(
      "ffmpeg is not installed. On macOS run: brew install ffmpeg (then restart the app).",
    );
  }
}

function run(
  bin: "ffmpeg" | "ffprobe",
  args: string[],
  timeoutMs = 240_000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const full =
      bin === "ffmpeg"
        ? ["-hide_banner", "-loglevel", "error", "-y", ...args]
        : args;
    const p = spawn(bin, full, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-1500)));
    p.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new FfmpegMissingError() : e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else
        reject(
          new Error(
            `${bin} failed: ${err.trim().split("\n").slice(-3).join(" ")}`,
          ),
        );
    });
  });
}

let status: { available: boolean; version: string | null } | null = null;
export async function ffmpegStatus() {
  if (status?.available) return status;
  try {
    const out = (await run("ffmpeg", ["-version"], 10_000)).toString();
    status = { available: true, version: out.split("\n")[0] ?? null };
  } catch {
    status = { available: false, version: null };
  }
  return status;
}

export async function requireFfmpeg(): Promise<void> {
  if (!(await ffmpegStatus()).available) throw new FfmpegMissingError();
}

const hex0x = (c: string) => `0x${c.replace("#", "").toLowerCase()}`;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface KeyOpts {
  keyColor: string;
  similarity?: number;
  blend?: number;
}

/** Despill the dominant channel of the key colour (green by default). */
function despillFor(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  if (g >= r && g >= b) return ",despill=type=green";
  if (b >= r && b >= g) return ",despill=type=blue";
  return "";
}

export function keyFilter(o: KeyOpts): string {
  const sim = o.similarity ?? 0.15;
  const blend = o.blend ?? 0.05;
  return `chromakey=${hex0x(o.keyColor)}:${sim}:${blend}${despillFor(o.keyColor)}`;
}

export interface MediaInfo {
  width: number;
  height: number;
  fps: number;
  duration: number | null;
  hasAlpha: boolean;
}

export async function probe(path: string): Promise<MediaInfo> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,pix_fmt,duration",
    "-of",
    "json",
    path,
  ]);
  const s = JSON.parse(out.toString()).streams?.[0];
  if (!s) throw new Error("No video/image stream found.");
  const [n, d] = String(s.r_frame_rate ?? "24/1")
    .split("/")
    .map(Number);
  return {
    width: s.width,
    height: s.height,
    fps: d ? n / d : 24,
    duration: s.duration ? Number(s.duration) : null,
    hasAlpha:
      /a/.test(String(s.pix_fmt).replace(/^yuv|^rgb|^bgr/, "")) &&
      /(rgba|bgra|argb|yuva|gbra|pal8)/.test(String(s.pix_fmt)),
  };
}

/** Average colour of a small patch near the top-left corner, as #rrggbb. */
export async function sampleCorner(path: string): Promise<string> {
  const buf = await run("ffmpeg", [
    "-i",
    path,
    "-vf",
    "select=eq(n\\,0),crop=8:8:4:4,scale=1:1:flags=area,format=rgb24",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-",
  ]);
  if (buf.length < 3)
    throw new Error("Could not sample the background colour.");
  return `#${[...buf.subarray(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Target size to reach `aspect` ("16:9") by adding margin, never cropping. */
export function paddedSize(w: number, h: number, aspect: string) {
  const [a, b] = aspect.split(":").map(Number);
  if (!a || !b) return { width: even(w), height: even(h) };
  const ratio = a / b;
  if (w / h < ratio) return { width: even(h * ratio), height: even(h) };
  return { width: even(w), height: even(w / ratio) };
}

// ---- images ----

/** Remove the key colour from an image: PNG with real transparency. */
export async function keyImage(inPath: string, outPng: string, o: KeyOpts) {
  await run("ffmpeg", [
    "-i",
    inPath,
    "-vf",
    `format=rgba,${keyFilter(o)},format=rgba`,
    "-frames:v",
    "1",
    outPng,
  ]);
}

/** Flatten (possibly transparent) image onto a solid colour. */
export async function compositeImage(
  inPath: string,
  outPath: string,
  color: string,
) {
  const m = await probe(inPath);
  const w = even(m.width);
  const h = even(m.height);
  await run("ffmpeg", [
    "-i",
    inPath,
    "-f",
    "lavfi",
    "-i",
    `color=c=${hex0x(color)}:s=${w}x${h},format=rgb24`,
    "-filter_complex",
    `[0:v]format=rgba,scale=${w}:${h}[fg];[1:v][fg]overlay=format=rgb,format=rgb24`,
    "-frames:v",
    "1",
    outPath,
  ]);
}

/**
 * Add margin (filled with `color`) so the image reaches `aspect`. Transparent
 * pixels are flattened onto `color` too: dropping alpha would turn them black,
 * which a video model then has to "repair" in its first frames.
 */
export async function padToAspect(
  inPath: string,
  outPng: string,
  aspect: string,
  color: string,
) {
  const m = await probe(inPath);
  const { width, height } = paddedSize(m.width, m.height, aspect);
  const ow = Math.max(width, even(m.width));
  const oh = Math.max(height, even(m.height));
  await run("ffmpeg", [
    "-i",
    inPath,
    "-f",
    "lavfi",
    "-i",
    `color=c=${hex0x(color)}:s=${ow}x${oh},format=rgb24`,
    "-filter_complex",
    "[0:v]format=rgba[fg];[1:v][fg]overlay=(W-w)/2:(H-h)/2:format=rgb,format=rgb24",
    "-frames:v",
    "1",
    outPng,
  ]);
}

// ---- video ----

/** Drop the first N frames (models often re-render the very first frames). */
const trimPrefix = (n?: number) =>
  n && n > 0 ? `trim=start_frame=${Math.round(n)},setpts=PTS-STARTPTS,` : "";

export interface VideoOpts extends KeyOpts {
  /** Skip this many frames at the start. */
  trimFrames?: number;
  /** Composite onto this colour instead of keeping transparency. */
  background?: string | null;
  loop?: boolean;
  fps?: number;
  maxWidth?: number;
}

/** MP4 (H.264, PowerPoint friendly): key out the green, fill with a colour. */
export async function videoToMp4OnColor(
  inPath: string,
  outPath: string,
  o: VideoOpts & { background: string },
) {
  const m = await probe(inPath);
  const w = even(m.width);
  const h = even(m.height);
  await run("ffmpeg", [
    "-i",
    inPath,
    "-f",
    "lavfi",
    "-i",
    `color=c=${hex0x(o.background)}:s=${w}x${h}:r=${m.fps}`,
    "-filter_complex",
    `[0:v]${trimPrefix(o.trimFrames)}scale=${w}:${h},format=yuva420p,${keyFilter(o)}[fg];[1:v][fg]overlay=shortest=1:format=auto,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    "-c:v",
    "libx264",
    "-crf",
    "16",
    "-preset",
    "medium",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    "-movflags",
    "+faststart",
    "-an",
    outPath,
  ]);
}

/** GIF: transparent (keyed) or on a solid colour. GIF alpha is on/off only. */
export async function videoToGif(
  inPath: string,
  outPath: string,
  o: VideoOpts,
) {
  const fps = o.fps ?? 15;
  const scale = `fps=${fps},scale='min(${o.maxWidth ?? 480},iw)':-2:flags=lanczos`;
  const loop = o.loop === false ? "-1" : "0";
  if (o.background) {
    const m = await probe(inPath);
    const w = even(Math.min(o.maxWidth ?? 480, m.width));
    const h = even((m.height * w) / m.width);
    await run("ffmpeg", [
      "-i",
      inPath,
      "-f",
      "lavfi",
      "-i",
      `color=c=${hex0x(o.background)}:s=${w}x${h}:r=${fps}`,
      "-filter_complex",
      `[0:v]${trimPrefix(o.trimFrames)}fps=${fps},scale=${w}:${h}:flags=lanczos,format=yuva420p,${keyFilter(o)}[fg];[1:v][fg]overlay=shortest=1:format=auto,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
      "-loop",
      loop,
      outPath,
    ]);
    return;
  }
  await run("ffmpeg", [
    "-i",
    inPath,
    "-vf",
    `${trimPrefix(o.trimFrames)}${scale},format=yuva420p,${keyFilter(o)},format=rgba,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128`,
    "-loop",
    loop,
    outPath,
  ]);
}

/** WebM (VP9) with a real alpha channel. Plays in browsers, not PowerPoint. */
export async function videoToWebmAlpha(
  inPath: string,
  outPath: string,
  o: VideoOpts,
) {
  await run("ffmpeg", [
    "-i",
    inPath,
    "-vf",
    `format=yuva420p,${keyFilter(o)},format=yuva420p`,
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-b:v",
    "0",
    "-crf",
    "28",
    "-auto-alt-ref",
    "0",
    "-an",
    outPath,
  ]);
}

/** Forward + reverse, so a clip that does not return to its start loops. */
export async function pingPong(inPath: string, outMp4: string) {
  await run("ffmpeg", [
    "-i",
    inPath,
    "-filter_complex",
    "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,format=yuv420p",
    "-c:v",
    "libx264",
    "-crf",
    "17",
    "-movflags",
    "+faststart",
    "-an",
    outMp4,
  ]);
}
