"use client";

import { useEffect, useState } from "react";
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
    post<PlanResponse>("/api/jobs/plan", { ids })
      .then(setPlan)
      .catch((e) => setErr(e.message));
  }, [ids]);

  const ready = plan?.items.filter((i) => i.ready) ?? [];
  const start = async () => {
    setBusy(true); // also blocks double-clicks
    try {
      await post("/api/jobs/run", {
        ids: ready.map((i) => i.id),
        confirm: true,
      });
      onStarted();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
              <dt className="text-slate-500">Video model</dt>
              <dd>{plan.videoModel ?? "—"}</dd>
              <dt className="text-slate-500">Jobs ready</dt>
              <dd>
                {ready.length} of {plan.items.length}
              </dd>
              <dt className="text-slate-500">Concurrency</dt>
              <dd>{plan.concurrency} at a time</dd>
              <dt className="text-slate-500">Estimated cost</dt>
              <dd className="font-semibold">
                {mock ? "$0 (mock)" : money(plan.totalEstimatedUsd)}
                {!mock &&
                  plan.totalEstimatedUsd == null &&
                  plan.partialUsd > 0 && (
                    <span className="ml-1 font-normal text-slate-500">
                      (known part ≈ {money(plan.partialUsd)};{" "}
                      {plan.unknownCount} job(s) unpriced)
                    </span>
                  )}
              </dd>
            </dl>

            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th>Job</th>
                  <th>Steps</th>
                  <th className="text-right">Est. video cost</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((i) => (
                  <tr key={i.id} className="border-t align-top">
                    <td className="py-1 pr-2">
                      {i.name}
                      {i.errors.map((e, k) => (
                        <div key={k} className="text-xs text-rose-600">
                          {e}
                        </div>
                      ))}
                    </td>
                    <td className="py-1 pr-2 text-xs">
                      {i.ready
                        ? i.startsWithStill
                          ? "image → your approval → video"
                          : "video"
                        : "skipped"}
                    </td>
                    <td className="py-1 text-right">
                      {mock ? "$0" : money(i.estimatedCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
              <li>
                OpenRouter documents no way to cancel a submitted video job, so
                stopping here later won&apos;t stop billing for jobs already
                submitted.
              </li>
              <li>
                There is no idempotency key, so a submission is never retried
                automatically; an unclear outcome is flagged &quot;submission
                uncertain&quot;.
              </li>
              <li>
                Estimates come from published per-second prices; the real cost
                is shown when each job finishes. Starting-image costs
                aren&apos;t estimated.
              </li>
              {plan.items.some((i) => i.startsWithStill) &&
                !plan.autoApproveStills && (
                  <li>
                    Prepared starting images wait for your approval before any
                    video is paid for.
                  </li>
                )}
            </ul>
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={start}
            disabled={busy || !ready.length}
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy
              ? "Starting…"
              : `Start ${ready.length} job${ready.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
