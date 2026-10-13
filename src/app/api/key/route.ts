import { keySource, setSessionKey } from "@/lib/keys";
import { fail, json } from "@/lib/server";

/** Session-only key: kept in server memory, never stored or echoed back. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    key?: string | null;
  } | null;
  if (!body) return fail("Invalid JSON");
  if (body.key && !/^[\x21-\x7e]{8,300}$/.test(body.key.trim())) {
    return fail("That does not look like an API key.");
  }
  setSessionKey(body.key ?? null);
  return json({ keySource: keySource() });
}
