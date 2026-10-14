"use client";

import type { Item, ItemState } from "@/lib/types";

export const CHECKER =
  "bg-[length:16px_16px] bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%),linear-gradient(45deg,#e5e7eb_25%,#fff_25%,#fff_75%,#e5e7eb_75%)] bg-[position:0_0,8px_8px]";

const STATE_LABEL: Record<ItemState, string> = {
  draft: "Draft",
  queued: "Queued",
  submitting: "Submitting",
  generating: "Generating",
  downloading: "Downloading",
  completed: "Done",
  failed: "Failed",
  submission_uncertain: "Uncertain",
};
const STATE_COLOR: Record<ItemState, string> = {
  draft: "bg-slate-100 text-slate-600",
  queued: "bg-slate-200 text-slate-700",
  submitting: "bg-sky-100 text-sky-800",
  generating: "bg-sky-100 text-sky-800",
  downloading: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  submission_uncertain: "bg-orange-100 text-orange-800",
};

export function StateBadge({ item }: { item: Item }) {
  if (item.state === "completed") {
    if (item.verdict === "kept")
      return <Pill cls="bg-emerald-100 text-emerald-800">✓ Kept</Pill>;
    if (item.verdict === "rejected")
      return <Pill cls="bg-slate-200 text-slate-500">Rejected</Pill>;
    return <Pill cls="bg-amber-100 text-amber-800">To review</Pill>;
  }
  return <Pill cls={STATE_COLOR[item.state]}>{STATE_LABEL[item.state]}</Pill>;
}

export function Pill({
  children,
  cls = "",
}: {
  children: React.ReactNode;
  cls?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

export function Btn({
  children,
  onClick,
  kind = "default",
  disabled,
  title,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  kind?: "default" | "primary" | "danger" | "ghost" | "success";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  const styles = {
    default:
      "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    success: "bg-emerald-700 text-white hover:bg-emerald-600",
    danger: "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Square thumbnail for an image item (checkerboard shows transparency). */
export function Thumb({
  item,
  className = "",
  bg,
}: {
  item: Item;
  className?: string;
  /** Solid preview colour instead of the checkerboard. */
  bg?: string | null;
}) {
  return (
    <div
      className={`overflow-hidden rounded-md border border-slate-200 ${bg ? "" : CHECKER} ${className}`}
      style={bg ? { backgroundColor: bg } : undefined}
    >
      {item.file ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/items/${item.id}/file?v=${item.file.file}`}
          alt={item.name}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
          no image
        </div>
      )}
    </div>
  );
}

export function elapsed(from: string | null): string {
  if (!from) return "";
  const s = Math.max(
    0,
    Math.round((Date.now() - new Date(from).getTime()) / 1000),
  );
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function Swatch({
  color,
  selected,
  onClick,
  title,
}: {
  color: string | null;
  selected?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? color ?? "Transparent"}
      onClick={onClick}
      className={`h-7 w-7 rounded-full border-2 ${selected ? "border-slate-900 ring-2 ring-slate-300" : "border-slate-300"} ${color ? "" : CHECKER}`}
      style={color ? { backgroundColor: color } : undefined}
      aria-label={title ?? color ?? "Transparent"}
    />
  );
}
