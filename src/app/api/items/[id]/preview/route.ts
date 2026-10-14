import { normalizeHex } from "@/lib/items";
import { renderItem } from "@/lib/exporter";
import { serveFile } from "@/lib/serveFile";
import { getStore } from "@/lib/store";

/** A clip composited on a chosen background colour (cached MP4). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const color = normalizeHex(url.searchParams.get("bg") ?? "");
  const format = url.searchParams.get("format") === "gif" ? "gif" : "mp4";
  const sim = Number(url.searchParams.get("sim")) || 0.15;
  const store = getStore();
  const item = store.item(id);
  // mp4 needs a colour; a GIF without a colour is the transparent preview
  if (!item || (format === "mp4" && !color))
    return new Response("Bad request", { status: 400 });
  try {
    const r = await renderItem(store, item, format, {
      background: color
        ? { mode: "color", color }
        : { mode: "transparent", color: "#ffffff" },
      similarity: Math.min(0.4, Math.max(0.05, sim)),
      pingPong: url.searchParams.get("loop") === "1",
    });
    if (!r.ok) return new Response(r.reason, { status: 422 });
    return serveFile(req, r.path, format === "gif" ? "image/gif" : "video/mp4");
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
}
