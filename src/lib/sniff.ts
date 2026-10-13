export interface ImageType {
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  ext: "png" | "jpg" | "webp";
}

/** Detect PNG/JPEG/WebP from magic bytes (never trust the client's type). */
export function sniffImage(buf: Uint8Array): ImageType | null {
  const b = buf;
  if (
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  ) {
    return { mediaType: "image/png", ext: "png" };
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mediaType: "image/jpeg", ext: "jpg" };
  }
  if (
    b.length > 12 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  ) {
    return { mediaType: "image/webp", ext: "webp" };
  }
  return null;
}

export type VideoFormat = "mp4" | "mov" | "webm" | "unknown";

/** Report the real container; callers must not just rename files. */
export function sniffVideo(buf: Uint8Array): VideoFormat {
  if (buf.length > 12 && String.fromCharCode(...buf.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...buf.slice(8, 12));
    return brand === "qt  " ? "mov" : "mp4";
  }
  if (
    buf.length > 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return "webm";
  }
  return "unknown";
}

export function toDataUrl(mediaType: string, bytes: Uint8Array): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}
