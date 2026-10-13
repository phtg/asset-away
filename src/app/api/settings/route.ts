import { fail, getRunner, json } from "@/lib/server";
import { getStore } from "@/lib/store";

const STR_NULL = [
  "defaultImageId",
  "videoModel",
  "stillModel",
  "helperModel",
] as const;

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return fail("Invalid JSON");
  const store = getStore();
  await store.update((s) => {
    const st = s.settings;
    if (typeof body.sharedInstructions === "string") {
      st.sharedInstructions = body.sharedInstructions.slice(0, 5000);
    }
    for (const k of STR_NULL) {
      if (k in body && (body[k] === null || typeof body[k] === "string")) {
        st[k] = (body[k] as string | null) || null;
      }
    }
    if (typeof body.concurrency === "number") {
      st.concurrency = Math.min(6, Math.max(1, Math.round(body.concurrency)));
    }
    if (typeof body.autoApproveStills === "boolean")
      st.autoApproveStills = body.autoApproveStills;
    if (typeof body.mock === "boolean") st.mock = body.mock;
  });
  getRunner().tick(); // a higher concurrency may free up queued jobs
  return json({ settings: store.get().settings });
}
