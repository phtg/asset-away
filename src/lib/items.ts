import { newId } from "./id";
import {
  DEFAULT_ANIMATION_RULES,
  DEFAULT_KEY_COLOR,
  DEFAULT_STYLE_RULES,
  type Item,
  type Project,
  type ProjectKind,
} from "./types";

export function newItem(
  p: Partial<Item> & Pick<Item, "projectId" | "kind" | "name">,
): Item {
  return {
    id: newId(),
    origin: p.kind === "clip" ? "clip" : "generated",
    order: 0,
    batchId: null,
    prompt: "",
    include: true,
    verdict: "pending",
    parentId: null,
    plateId: null,
    sourceId: null,
    duration: null,
    resolution: null,
    aspectRatio: null,
    seed: null,
    loop: false,
    suggestion: null,
    state: "draft",
    error: null,
    uncertainStage: null,
    run: null,
    providerJobId: null,
    pollingUrl: null,
    providerStatus: null,
    pollError: null,
    costUsd: null,
    file: null,
    createdAt: new Date().toISOString(),
    queuedAt: null,
    submittedAt: null,
    completedAt: null,
    ...p,
  };
}

export function newProject(
  name: string,
  kind: ProjectKind = "mascot",
  over: Partial<Project> = {},
): Project {
  return {
    id: newId(),
    name,
    kind,
    brief: "",
    styleRules: DEFAULT_STYLE_RULES[kind],
    animationRules: DEFAULT_ANIMATION_RULES,
    cutout: true,
    greenScreen: true,
    keyColor: DEFAULT_KEY_COLOR,
    background: { mode: "transparent", color: "#ffffff" },
    anchorId: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

export const HEX = /^#[0-9a-fA-F]{6}$/;

export function normalizeHex(v: string): string | null {
  const s = v.trim().replace(/^#?/, "#").toLowerCase();
  return HEX.test(s) ? s : null;
}

/** Pixel size and alpha presence from PNG/WebP headers (no ffmpeg needed). */
export function inspectImage(buf: Uint8Array): {
  width: number | null;
  height: number | null;
  hasAlpha: boolean;
} {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG: IHDR at offset 16 (width, height), color type at 25; tRNS = alpha too
  if (buf.length > 33 && buf[0] === 0x89 && buf[1] === 0x50) {
    const colorType = buf[25];
    let alpha = colorType === 4 || colorType === 6;
    if (!alpha) {
      const text = Buffer.from(buf.subarray(33, Math.min(buf.length, 4096)));
      alpha = text.includes("tRNS");
    }
    return {
      width: dv.getUint32(16),
      height: dv.getUint32(20),
      hasAlpha: alpha,
    };
  }
  // WebP
  if (buf.length > 30 && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") {
    const fourcc = String.fromCharCode(...buf.slice(12, 16));
    if (fourcc === "VP8X") {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h, hasAlpha: (buf[20] & 0x10) !== 0 };
    }
    if (fourcc === "VP8L") {
      const bits = dv.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        hasAlpha: ((bits >> 28) & 1) === 1,
      };
    }
    return { width: null, height: null, hasAlpha: false };
  }
  // JPEG: scan for a SOF marker
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        return {
          height: dv.getUint16(i + 5),
          width: dv.getUint16(i + 7),
          hasAlpha: false,
        };
      }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return { width: null, height: null, hasAlpha: false };
}
