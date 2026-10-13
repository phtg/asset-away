import { keySource } from "@/lib/keys";
import { isMock } from "@/lib/providers";
import { currentProvider, getRunner, json } from "@/lib/server";
import { getStore } from "@/lib/store";

export async function GET() {
  const store = getStore();
  getRunner(); // starts recovery/resume on first request
  const s = store.get();
  const p = currentProvider();
  return json({
    settings: s.settings,
    images: s.images,
    jobs: s.jobs,
    keySource: keySource(),
    mock: isMock(s.settings),
    mockForcedByEnv: process.env.MOCK_MODE === "1",
    provider: { id: p.id, label: p.label },
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 10,
    activeCount: getRunner().activeCount,
  });
}
