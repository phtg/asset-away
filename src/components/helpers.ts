import type { Item } from "@/lib/types";

/** A clip generated on a key colour can be keyed/recoloured (mirrors server). */
export function isKeyableClient(item: Item): boolean {
  return item.kind === "clip" && item.run?.startFrame === "plate";
}

/** Images that can be animated / used as references. */
export function keptImages(items: Item[]): Item[] {
  return items.filter(
    (i) =>
      i.kind === "image" &&
      i.origin !== "plate" &&
      i.state === "completed" &&
      i.verdict === "kept",
  );
}

export const isBusy = (i: Item) =>
  ["queued", "submitting", "generating", "downloading"].includes(i.state);

export function batchTitle(createdAt: string): string {
  const d = new Date(createdAt);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}
