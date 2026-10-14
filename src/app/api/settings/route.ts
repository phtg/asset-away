import { normalizeHex } from "@/lib/items";
import { fail, getRunner, json } from "@/lib/server";
import { getStore } from "@/lib/store";

const STR_NULL = [
  "videoModel",
  "imageModel",
  "helperModel",
  "activeProjectId",
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
    for (const k of STR_NULL) {
      if (k in body && (body[k] === null || typeof body[k] === "string")) {
        st[k] = (body[k] as string | null) || null;
      }
    }
    if (typeof body.concurrency === "number") {
      st.concurrency = Math.min(6, Math.max(1, Math.round(body.concurrency)));
    }
    if (typeof body.mock === "boolean") st.mock = body.mock;
    if (Array.isArray(body.savedColors)) {
      st.savedColors = [
        ...new Set(
          body.savedColors.flatMap((c) =>
            (typeof c === "string" ? [normalizeHex(c)] : []).filter(
              (x): x is string => !!x,
            ),
          ),
        ),
      ].slice(0, 16);
    }
  });
  getRunner().tick();
  return json({ settings: store.get().settings });
}
