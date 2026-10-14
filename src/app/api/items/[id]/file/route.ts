import { serveFile } from "@/lib/serveFile";
import { getStore } from "@/lib/store";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getStore();
  const item = store.item(id);
  const p = item && store.filePath(item);
  if (!item?.file || !p) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return serveFile(
    req,
    p,
    TYPES[item.file.format] ??
      item.file.contentType ??
      "application/octet-stream",
    download ? item.file.file : undefined,
  );
}
