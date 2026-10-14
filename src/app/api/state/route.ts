import { keySource } from "@/lib/keys";
import { isMock } from "@/lib/providers";
import {
  currentProvider,
  ensureProject,
  ffmpegStatus,
  getRunner,
  json,
} from "@/lib/server";
import { getStore } from "@/lib/store";

export async function GET(req: Request) {
  const store = getStore();
  getRunner(); // starts recovery/resume on first request
  const active = await ensureProject();
  const s = store.get();
  const wanted = new URL(req.url).searchParams.get("project");
  const project = s.projects.find((p) => p.id === wanted) ?? active;
  const p = currentProvider();
  return json({
    settings: s.settings,
    projects: s.projects.map(({ id, name, kind }) => ({
      id,
      name,
      kind,
      count: s.items.filter(
        (i) => i.projectId === id && i.state === "completed",
      ).length,
    })),
    project,
    batches: s.batches.filter((b) => b.projectId === project.id),
    items: s.items.filter((i) => i.projectId === project.id),
    keySource: keySource(),
    mock: isMock(s.settings),
    mockForcedByEnv: process.env.MOCK_MODE === "1",
    provider: { id: p.id, label: p.label },
    ffmpeg: await ffmpegStatus(),
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 10,
    activeCount: getRunner().activeCount,
  });
}
