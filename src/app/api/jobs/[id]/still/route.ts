import path from "node:path";
import { serveFile } from "@/lib/serveFile";
import { getStore } from "@/lib/store";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getStore();
  const job = store.job(id);
  if (!job?.still) return new Response("Not found", { status: 404 });
  return serveFile(
    req,
    path.join(store.stillsDir, job.still.file),
    job.still.mediaType,
  );
}
