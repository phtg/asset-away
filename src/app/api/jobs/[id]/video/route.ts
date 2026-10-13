import path from "node:path";
import { serveFile } from "@/lib/serveFile";
import { getStore } from "@/lib/store";

const TYPES: Record<string, string> = {
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
  const job = store.job(id);
  if (!job?.output) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return serveFile(
    req,
    path.join(store.outputsDir, job.output.file),
    TYPES[job.output.format] ?? "application/octet-stream",
    download ? job.output.file : undefined,
  );
}
