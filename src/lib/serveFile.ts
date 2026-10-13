import fs from "node:fs";

/** Serve a local file with Range support (so <video> can seek). */
export function serveFile(
  req: Request,
  filePath: string,
  contentType: string,
  downloadName?: string,
): Response {
  if (!fs.existsSync(filePath))
    return new Response("Not found", { status: 404 });
  const buf = fs.readFileSync(filePath);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (downloadName) {
    headers["Content-Disposition"] =
      `attachment; filename="${downloadName.replace(/[^\w.-]/g, "_")}"`;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1]
      ? Number(range[1])
      : Math.max(0, buf.length - Number(range[2]));
    const end =
      range[1] && range[2]
        ? Math.min(Number(range[2]), buf.length - 1)
        : buf.length - 1;
    if (start > end || start >= buf.length) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${buf.length}` },
      });
    }
    return new Response(buf.subarray(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${buf.length}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(buf, {
    headers: { ...headers, "Content-Length": String(buf.length) },
  });
}
