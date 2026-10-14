import fs from "node:fs";
import path from "node:path";
import { inspectImage, newItem } from "@/lib/items";
import { fail, json } from "@/lib/server";
import { sniffImage } from "@/lib/sniff";
import { getStore } from "@/lib/store";
import type { Item } from "@/lib/types";

const MAX_IMAGES = 500;

/** Upload reference images (PNG/JPEG/WebP). They enter the library as kept. */
export async function POST(req: Request) {
  const maxBytes = (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024;
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Expected a multipart upload.");
  const projectId = String(form.get("projectId") ?? "");
  const store = getStore();
  if (!store.get().projects.some((p) => p.id === projectId))
    return fail("Unknown project.");
  const created: Item[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const f of form.getAll("files")) {
    if (!(f instanceof File)) continue;
    if (store.get().items.length + created.length >= MAX_IMAGES) {
      rejected.push({
        name: f.name,
        reason: `Limit of ${MAX_IMAGES} items reached.`,
      });
      continue;
    }
    if (f.size > maxBytes) {
      rejected.push({
        name: f.name,
        reason: `Larger than ${maxBytes / 1048576} MB.`,
      });
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type) {
      rejected.push({ name: f.name, reason: "Not a PNG, JPEG or WebP image." });
      continue;
    }
    const item = newItem({
      projectId,
      kind: "image",
      origin: "upload",
      name:
        f.name
          .replace(/\.[^.]+$/, "")
          .replace(/[^\w .()-]+/g, "_")
          .slice(0, 80) || "image",
      verdict: "kept",
      include: false,
      state: "completed",
      completedAt: new Date().toISOString(),
    });
    const file = `${item.id}.${type.ext}`;
    fs.writeFileSync(path.join(store.imagesDir, file), bytes);
    item.file = {
      file,
      mediaType: type.mediaType,
      bytes: bytes.length,
      format: type.ext,
      contentType: null,
      ...inspectImage(bytes),
    };
    created.push(item);
  }

  await store.update((s) => {
    let order = s.items.reduce((m, j) => Math.max(m, j.order), 0);
    for (const c of created) c.order = ++order;
    s.items.push(...created);
    const p = s.projects.find((x) => x.id === projectId)!;
    if (!p.anchorId && created.length) p.anchorId = created[0].id;
  });
  return json({ created, rejected });
}
