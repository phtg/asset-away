import { getRunner, json } from "@/lib/server";

export async function POST() {
  const stopped = await getRunner().stopQueued();
  return json({
    stopped,
    note: "Queued items were returned to draft. Requests already sent to the provider cannot be cancelled (OpenRouter documents no cancel call), so they keep running and billing.",
  });
}
