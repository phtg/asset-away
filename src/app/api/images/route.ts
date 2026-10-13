import fs from "node:fs";
import path from "node:path";
import { fail, json, newId } from "@/lib/server";
import { sniffImage } from "@/lib/sniff";
import { getStore } from "@/lib/store";
import type { ImageRecord } from "@/lib/types";

const MAX_IMAGES = 100;

export async function POST(req: Request) {
  const maxBytes = (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024;
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Expected a multipart upload.");
  const store = getStore();
  const created: ImageRecord[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const f of form.getAll("files")) {
    if (!(f instanceof File)) continue;
    if (store.get().images.length + created.length >= MAX_IMAGES) {
      rejected.push({
        name: f.name,
        reason: `Limit of ${MAX_IMAGES} images reached.`,
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
    const id = newId();
    const file = `${id}.${type.ext}`;
    fs.writeFileSync(path.join(store.imagesDir, file), bytes);
    created.push({
      id,
      name:
        f.name
          .replace(/\.[^.]+$/, "")
          .replace(/[^\w .()-]+/g, "_")
          .slice(0, 80) || "image",
      file,
      mediaType: type.mediaType,
      bytes: bytes.length,
      identityRef: true,
      createdAt: new Date().toISOString(),
    });
  }

  await store.update((s) => {
    s.images.push(...created);
    if (!s.settings.defaultImageId && created.length)
      s.settings.defaultImageId = created[0].id;
  });
  return json({ created, rejected });
}
