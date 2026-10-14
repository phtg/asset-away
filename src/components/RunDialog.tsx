"use client";

import { useEffect, useState } from "react";
import { Btn } from "./ui";
import { money, post, type PlanResponse } from "./api";

export function RunDialog({
  ids,
  mock,
  onClose,
  onStarted,
}: {
  ids: string[];
  mock: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    post<PlanResponse>("/api/run/plan", { ids })
      .then(setPlan)
      .catch((e) => setErr(e.message));
  }, [ids]);

  const ready = plan?.items.filter((i) => i.ready) ?? [];
  const images = ready.filter((i) => i.kind === "image").length;
  const clips = ready.filter((i) => i.kind === "clip").length;
  const start = async () => {
    setBusy(true); // also blocks double-clicks
    try {
      await post("/api/run", { ids: ready.map((i) => i.id), confirm: true });
      onStarted();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">Confirm generation</h3>
        {err && (
          <p className="mt-2 rounded bg-rose-50 p-2 text-sm text-rose-700">
            {err}
          </p>
        )}
        {!plan && !err && (
          <p className="mt-2 text-sm text-slate-500">Checking settings…</p>
        )}
        {plan && (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Provider</dt>
              <dd className={mock ? "font-semibold text-amber-700" : ""}>
                {plan.provider.label}
              </dd>
              {images > 0 && (
                <>
                  <dt className="text-slate-500">Image model</dt>
                  <dd>{plan.imageModel ?? "—"}</dd>
                </>
              )}
              {clips > 0 && (
                <>
                  <dt className="text-slate-500">Video model</dt>
                  <dd>{plan.videoModel ?? "—"}</dd>
                </>
              )}
              <dt className="text-slate-500">Ready</dt>
              <dd>
                {images > 0 && `${images} image${images === 1 ? "" : "s"}`}
                {images > 0 && clips > 0 && " + "}
                {clips > 0 && `${clips} clip${clips === 1 ? "" : "s"}`} of{" "}
                {plan.items.length}
              </dd>
              <dt className="text-slate-500">Concurrency</dt>
              <dd>{plan.concurrency} at a time</dd>
              <dt className="text-slate-500">Estimated cost</dt>
              <dd className="font-semibold">
                {mock ? "$0 (mock)" : money(plan.totalEstimatedUsd)}
                {!mock && plan.totalEstimatedUsd == null && (
                  <span className="ml-1 font-normal text-slate-500">
                    {plan.partialUsd > 0
                      ? `(clips ≈ ${money(plan.partialUsd)}; `
                      : "("}
                    {plan.unknownCount} item(s) unpriced — image prices are
                    reported after generation)
                  </span>
                )}
              </dd>
            </dl>

            <ul className="mt-3 divide-y text-sm">
              {plan.items.map((i) => (
                <li key={i.id} className="py-1.5">
                  <div className="flex justify-between gap-3">
                    <span>
                      <span className="mr-1 text-xs text-slate-400">
                        {i.kind === "image" ? "IMG" : "CLIP"}
                      </span>
                      {i.name}
                    </span>
                    <span className="text-slate-600">
                      {i.ready
                        ? mock
                          ? "$0"
                          : i.kind === "clip"
                            ? money(i.estimatedCostUsd)
                            : "—"
                        : "skipped"}
                    </span>
                  </div>
                  {i.errors.map((e, k) => (
                    <div key={k} className="text-xs text-rose-600">
                      {e}
                    </div>
                  ))}
                  {i.notes.map((e, k) => (
                    <div key={k} className="text-xs text-slate-500">
                      {e}
                    </div>
                  ))}
                </li>
              ))}
            </ul>

            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
              <li>
                OpenRouter documents no way to cancel a submitted request, so
                stopping later won&apos;t stop billing for requests already
                sent.
              </li>
              <li>
                There is no idempotency key, so a paid request is never retried
                automatically; an unclear outcome is flagged “submission
                uncertain”.
              </li>
              <li>
                Review each result before building on it. Nothing animates until
                you keep its image.
              </li>
            </ul>
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="success" onClick={start} disabled={busy || !ready.length}>
            {busy
              ? "Starting…"
              : `Start ${ready.length} item${ready.length === 1 ? "" : "s"}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}
