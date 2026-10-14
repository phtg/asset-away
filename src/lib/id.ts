export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
