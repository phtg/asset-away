import { fail, json, newId } from "@/lib/server";
import { getStore } from "@/lib/store";
import type { Job } from "@/lib/types";

const MAX_JOBS = 300;

const optStr = (v: unknown, max = 4000) =>
  typeof v === "string" ? v.slice(0, max) : "";
const optNullStr = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 20) : null;
const optInt = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) ? v : null;

/** Bulk-create draft jobs (from pasted prompts or an imported JSON file). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    jobs?: Record<string, unknown>[];
  } | null;
  if (!body || !Array.isArray(body.jobs))
    return fail('Expected {"jobs": [...]}');
  const store = getStore();
  const created: Job[] = [];
  await store.update((s) => {
    let order = s.jobs.reduce((m, j) => Math.max(m, j.order), 0);
    for (const raw of body.jobs!) {
      if (s.jobs.length + created.length >= MAX_JOBS) break;
      const name = optStr(raw.name, 80).trim();
      if (!name) continue;
      const imgName =
        typeof raw.startImageName === "string" ? raw.startImageName : null;
      const imgId =
        typeof raw.startImageId === "string"
          ? raw.startImageId
          : imgName
            ? (s.images.find((i) => i.name === imgName)?.id ?? null)
            : null;
      created.push({
        id: newId(),
        order: ++order,
        name,
        include: raw.include !== false,
        mode: raw.mode === "prepare" ? "prepare" : "animate",
        startImageId: s.images.some((i) => i.id === imgId) ? imgId : null,
        actionPrompt: optStr(raw.actionPrompt),
        stillPrompt: optStr(raw.stillPrompt),
        duration: optInt(raw.duration),
        resolution: optNullStr(raw.resolution),
        aspectRatio: optNullStr(raw.aspectRatio),
        seed: optInt(raw.seed),
        state: "draft",
        error: null,
        uncertainStage: null,
        run: null,
        still: null,
        providerJobId: null,
        pollingUrl: null,
        providerStatus: null,
        pollError: null,
        costUsd: null,
        output: null,
        createdAt: new Date().toISOString(),
        queuedAt: null,
        submittedAt: null,
        completedAt: null,
      });
    }
    s.jobs.push(...created);
  });
  return json({ created: created.length });
}
