/** Strip anything that looks like a credential from text we might show/log. */
export function redact(text: string, extraSecrets: string[] = []): string {
  let out = text;
  for (const s of extraSecrets) {
    if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  }
  return out
    .replace(/sk-or-[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{64,}/gi, "[image data]");
}
