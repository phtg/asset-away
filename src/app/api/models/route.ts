import { redact } from "@/lib/redact";
import { realSleep, withBackoff } from "@/lib/retry";
import { currentProvider, fail, json } from "@/lib/server";

export async function GET() {
  const p = currentProvider();
  const opts = { tries: 3, baseMs: 1000, sleep: realSleep };
  try {
    const [video, image, chat] = await Promise.all([
      withBackoff(() => p.listVideoModels(), opts),
      withBackoff(() => p.listImageModels(), opts),
      withBackoff(() => p.listChatModels(), opts),
    ]);
    chat.sort((a, b) => (a.promptPrice ?? 1) - (b.promptPrice ?? 1));
    return json({ provider: p.id, video, image, chat });
  } catch (e) {
    return fail(redact(`Could not load models: ${(e as Error).message}`), 502);
  }
}
