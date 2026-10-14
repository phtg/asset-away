import { newProject } from "@/lib/items";
import { fail, json } from "@/lib/server";
import { getStore } from "@/lib/store";
import type { ProjectKind } from "@/lib/types";

const KINDS: ProjectKind[] = ["mascot", "icon", "illustration", "other"];

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    name?: string;
    kind?: string;
  } | null;
  const name = b?.name?.trim().slice(0, 60);
  if (!name) return fail("Give the project a name.");
  const kind = KINDS.includes(b?.kind as ProjectKind)
    ? (b!.kind as ProjectKind)
    : "mascot";
  const store = getStore();
  const p = newProject(name, kind);
  await store.update((s) => {
    s.projects.push(p);
    s.settings.activeProjectId = p.id;
  });
  return json({ project: p });
}
