import type { ExportOptions } from "./exporter";
import type { AppState, Item } from "./types";

export function buildManifest(
  state: AppState,
  items: Item[],
  opts: ExportOptions,
  results: {
    item: string;
    format: string;
    file: string | null;
    skipped?: string;
  }[],
) {
  const project = state.projects.find((p) => p.id === items[0]?.projectId);
  return {
    app: "asset-away",
    generatedAt: new Date().toISOString(),
    project: project && {
      name: project.name,
      kind: project.kind,
      brief: project.brief,
      styleRules: project.styleRules,
      animationRules: project.animationRules,
    },
    background:
      opts.background.mode === "color"
        ? `solid ${opts.background.color}`
        : "transparent",
    note: "Prompts, models and settings are what was actually submitted. GIF transparency is on/off only (no soft edges). Clips are keyed from a green screen; edges may need a different tolerance.",
    exported: results,
    items: items.map((j) => {
      const src = state.items.find((i) => i.id === j.sourceId);
      return {
        name: j.name,
        kind: j.kind,
        origin: j.origin,
        id: j.id,
        file: j.file?.file ?? null,
        format: j.file?.format ?? null,
        width: j.file?.width ?? null,
        height: j.file?.height ?? null,
        hasAlpha: j.file?.hasAlpha ?? null,
        sourceImage: src?.name ?? null,
        prompt: j.prompt,
        fullPrompt: j.run?.fullPrompt ?? null,
        provider: j.run?.provider ?? null,
        model: j.run?.model ?? null,
        referenceImages: j.run?.refNames ?? [],
        duration: j.run?.duration ?? null,
        resolution: j.run?.resolution ?? null,
        aspectRatio: j.run?.aspectRatio ?? null,
        loop: j.kind === "clip" ? j.loop : null,
        loopMode: j.run?.loopMode ?? null,
        suggestion: j.suggestion,
        seed: j.run?.seed ?? null,
        providerJobId: j.providerJobId,
        estimatedCostUsd: j.run?.estimatedCostUsd ?? null,
        reportedCostUsd: j.costUsd,
        verdict: j.verdict,
        queuedAt: j.queuedAt,
        completedAt: j.completedAt,
      };
    }),
  };
}
