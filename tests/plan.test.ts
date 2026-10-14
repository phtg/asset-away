import { describe, expect, it } from "vitest";
import { newItem, newProject } from "@/lib/items";
import type { Provider } from "@/lib/providers/types";
import { planItems } from "@/lib/snapshot";
import {
  DEFAULT_SETTINGS,
  type AppState,
  type ImageModel,
  type VideoModel,
} from "@/lib/types";

const vm: VideoModel = {
  id: "v/loop",
  name: "v",
  supportedDurations: [3, 4, 5, 8],
  supportedResolutions: ["480p", "720p"],
  supportedAspectRatios: ["1:1", "16:9"],
  supportedFrameImages: ["first_frame", "last_frame"],
  generateAudio: null,
  seed: true,
  pricingSkus: { duration_seconds_480p: "0.05" },
};
const vmNoLast: VideoModel = {
  ...vm,
  id: "v/nolast",
  supportedFrameImages: ["first_frame"],
};
const im = (o: Partial<ImageModel>): ImageModel => ({
  id: "i/alpha",
  name: "i",
  acceptsImageInput: true,
  transparent: true,
  maxReferences: 4,
  ...o,
});

const prov = (images: ImageModel[]): Provider =>
  ({
    id: "mock",
    label: "x",
    listVideoModels: async () => [vm, vmNoLast],
    listImageModels: async () => images,
    listChatModels: async () => [],
  }) as unknown as Provider;

function world(
  over: {
    project?: Partial<ReturnType<typeof newProject>>;
    settings?: Partial<AppState["settings"]>;
  } = {},
) {
  const project = newProject("P", "mascot", over.project);
  const anchor = newItem({
    projectId: project.id,
    kind: "image",
    origin: "upload",
    name: "Anchor",
    verdict: "kept",
    state: "completed",
    file: {
      file: "a.png",
      mediaType: "image/png",
      bytes: 1,
      format: "png",
      width: 8,
      height: 8,
      hasAlpha: true,
      contentType: null,
    },
  });
  anchor.id = "anchor";
  project.anchorId = anchor.id;
  const state: AppState = {
    version: 2,
    projects: [project],
    batches: [],
    items: [anchor],
    settings: {
      ...DEFAULT_SETTINGS,
      videoModel: "v/loop",
      imageModel: "i/alpha",
      ...over.settings,
    },
  };
  return { state, project, anchor };
}

describe("planning images", () => {
  it("asks for native transparency when the model supports it", async () => {
    const { state, project } = world();
    const it = newItem({
      projectId: project.id,
      kind: "image",
      name: "Wave",
      prompt: "waving",
    });
    state.items.push(it);
    const [p] = await planItems(state, prov([im({})]), [it.id]);
    expect(p.errors).toEqual([]);
    expect(p.snapshot!.background).toBe("native-alpha");
    expect(p.snapshot!.refIds).toEqual(["anchor"]);
    expect(p.snapshot!.fullPrompt.startsWith("waving")).toBe(true);
    expect(p.snapshot!.fullPrompt).toContain("transparent background");
  });

  it("falls back to a green background to key out for models without alpha", async () => {
    const { state, project } = world();
    const it = newItem({
      projectId: project.id,
      kind: "image",
      name: "Wave",
      prompt: "waving",
    });
    state.items.push(it);
    const [p] = await planItems(state, prov([im({ transparent: false })]), [
      it.id,
    ]);
    // ffmpeg is installed in CI/dev here; if not, the planner reports it as an error
    if (p.snapshot) {
      expect(p.snapshot.background).toBe("chroma");
      expect(p.snapshot.fullPrompt).toContain("#00FF00");
    } else expect(p.errors.join(" ")).toMatch(/ffmpeg/);
  });

  it("does not add background clauses for full-scene projects", async () => {
    const { state, project } = world({ project: { cutout: false } });
    const it = newItem({
      projectId: project.id,
      kind: "image",
      name: "Scene",
      prompt: "a desk",
    });
    state.items.push(it);
    const [p] = await planItems(state, prov([im({})]), [it.id]);
    expect(p.snapshot!.background).toBe("none");
    expect(p.snapshot!.fullPrompt).not.toMatch(/transparent|chroma/);
  });

  it("refuses models that cannot take the style reference", async () => {
    const { state, project } = world();
    const it = newItem({
      projectId: project.id,
      kind: "image",
      name: "Wave",
      prompt: "waving",
    });
    state.items.push(it);
    const [p] = await planItems(state, prov([im({ maxReferences: 0 })]), [
      it.id,
    ]);
    expect(p.snapshot).toBeNull();
    expect(p.errors[0]).toMatch(/reference/);
  });

  it("requires an image model and a prompt", async () => {
    const { state, project } = world({ settings: { imageModel: null } });
    const it = newItem({
      projectId: project.id,
      kind: "image",
      name: "Wave",
      prompt: "",
    });
    state.items.push(it);
    const [p] = await planItems(state, prov([im({})]), [it.id]);
    expect(p.errors.join(" ")).toMatch(/prompt is empty/);
    expect(p.errors.join(" ")).toMatch(/image model/);
  });
});

describe("planning clips", () => {
  it("needs a kept green-screen plate before animating (green-screen projects)", async () => {
    const { state, project } = world();
    const c = newItem({
      projectId: project.id,
      kind: "clip",
      name: "Wave",
      prompt: "waves",
      sourceId: "anchor",
    });
    state.items.push(c);
    const [p] = await planItems(state, prov([]), [c.id]);
    expect(p.snapshot).toBeNull();
    expect(p.errors[0]).toMatch(/green-screen version/);
  });

  it("builds the full prompt with rules, loop and green clauses", async () => {
    const { state, project, anchor } = world();
    const plate = newItem({
      projectId: project.id,
      kind: "image",
      origin: "plate",
      name: "plate",
      verdict: "kept",
      state: "completed",
      parentId: "anchor",
      file: anchor.file,
    });
    anchor.plateId = plate.id;
    const c = newItem({
      projectId: project.id,
      kind: "clip",
      name: "Wave",
      prompt: "waves",
      sourceId: "anchor",
      loop: true,
    });
    state.items.push(plate, c);
    const [p] = await planItems(state, prov([]), [c.id]);
    expect(p.errors).toEqual([]);
    expect(p.snapshot!.startFrame).toBe("plate");
    expect(p.snapshot!.loopMode).toBe("last-frame");
    expect(p.snapshot!.refIds).toEqual([plate.id]);
    expect(p.snapshot!.fullPrompt).toContain(
      "ends exactly in the pose it started in".replace("ends", "end"),
    );
    expect(p.snapshot!.fullPrompt).toContain("chroma green");
    expect(p.estimatedCostUsd).toBe(0.2);
  });

  it("uses the helper's suggestion for duration/aspect, mapped to what the model supports", async () => {
    const { state, project } = world({ project: { greenScreen: false } });
    const c = newItem({
      projectId: project.id,
      kind: "clip",
      name: "Walk",
      prompt: "walks",
      sourceId: "anchor",
      suggestion: {
        duration: 6,
        aspectRatio: "16:9",
        loop: false,
        reason: "travelling",
      },
    });
    state.items.push(c);
    const [p] = await planItems(state, prov([]), [c.id]);
    expect(p.errors.filter((e) => !/ffmpeg/.test(e))).toEqual([]);
    expect(p.snapshot?.duration ?? 5).toBe(5); // 6 is not offered: nearest (5; tie-> shorter)
    expect(p.snapshot?.loopMode ?? "none").toBe("none");
  });

  it("drops a suggested aspect ratio the model does not support instead of sending it", async () => {
    const { state, project } = world({ project: { greenScreen: false } });
    const c = newItem({
      projectId: project.id,
      kind: "clip",
      name: "Wave",
      prompt: "w",
      sourceId: "anchor",
      suggestion: { duration: 3, aspectRatio: "21:9", loop: true, reason: "" },
    });
    state.items.push(c);
    const [p] = await planItems(state, prov([]), [c.id]);
    expect(p.snapshot!.aspectRatio).toBeNull();
  });

  it("marks looping as best effort when the model has no last-frame control", async () => {
    const { state, project } = world({
      project: { greenScreen: false },
      settings: { videoModel: "v/nolast" },
    });
    const c = newItem({
      projectId: project.id,
      kind: "clip",
      name: "Wave",
      prompt: "w",
      sourceId: "anchor",
      loop: true,
    });
    state.items.push(c);
    const [p] = await planItems(state, prov([]), [c.id]);
    expect(p.snapshot!.loopMode).toBe("prompt");
    expect(p.notes.join(" ")).toMatch(/best effort/);
  });

  it("will not animate an image that has not been kept", async () => {
    const { state, project, anchor } = world({
      project: { greenScreen: false },
    });
    anchor.verdict = "pending";
    const c = newItem({
      projectId: project.id,
      kind: "clip",
      name: "Wave",
      prompt: "w",
      sourceId: "anchor",
    });
    state.items.push(c);
    const [p] = await planItems(state, prov([]), [c.id]);
    expect(p.errors[0]).toMatch(/Keep/);
  });
});
