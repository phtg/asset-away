# Asset Away

A quick-and-dirty, single-user, local web app for batch-generating short
character animations (image → video) for PowerPoint. Paste many prompts, pick a
starting image for each, review the cost, generate in a batch, download MP4s +
a manifest as a ZIP.

Next.js + TypeScript + Tailwind. Local filesystem storage. No auth, billing,
database or cloud infrastructure.

## Quick start

```bash
npm install
cp .env.example .env.local   # then put your OpenRouter key in it
npm run dev                  # http://localhost:3000
```

No key yet? Tick **Mock mode** in the Provider panel (or start with
`MOCK_MODE=1 npm run dev`) to try the whole workflow for free.

> An OpenRouter **API key is separate from any chat subscription** (Claude,
> ChatGPT, …). Create one at <https://openrouter.ai/keys> and add credits.
> Only one key is needed.

## What I verified before building (official OpenRouter docs, Oct 2026)

| Question                                | Answer                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does OpenRouter do image-to-video?      | **Yes.** Async API: `POST /api/v1/videos` → poll `GET /api/v1/videos/{id}` → download `GET /api/v1/videos/{id}/content`. Not chat-completions. **No fal.ai needed.**                                           |
| How is the starting image sent?         | `frame_images: [{type:"image_url", image_url:{url}, frame_type:"first_frame"}]`. URL can be public HTTPS or a data URL (per OpenRouter's official `openrouter-video` skill). This app sends a base64 data URL. |
| Multiple identity references for video? | `input_references` exists, but if `frame_images` is present the request is image-to-video and references are ignored. So video gets **one** starting frame.                                                    |
| Which models/settings/prices?           | Live from `GET /api/v1/videos/models` (durations, resolutions, aspect ratios, `supported_frame_images`, seed, audio, `pricing_skus`). Nothing is hard-coded.                                                   |
| Idempotency keys?                       | **None documented** for video submission.                                                                                                                                                                      |
| Cancelling a submitted video job?       | **No cancel call documented.**                                                                                                                                                                                 |
| Still images (image → image)?           | `POST /api/v1/images` with base64 `input_references` (several allowed; the number varies by provider).                                                                                                         |
| Output                                  | Content endpoint needs your API key in the `Authorization` header; completed jobs report `usage.cost`. The app saves the file immediately and reports the real container (never just renames).                 |

Sources: OpenRouter docs — Video Generation guide, "Turn an Image into a Video"
cookbook, Submit-a-video-generation-request API reference, Image Generation
guide, and the `openrouter-video` skill.

Things I could **not** verify without spending money: that every video model
accepts data-URL frames in practice (the docs and official skill say yes). If a
model rejects one, you get a clear failure on that job and nothing is charged
for a definitive 4xx rejection.

## Workflow

1. **Provider** – key status, video model (live list, filtered to models that
   accept a starting frame, cheapest first), optional image model for stills,
   optional helper model, concurrency (default 2).
2. **Reference images** – drag in PNG/JPEG/WebP (type checked by file contents,
   size-limited). Rename, choose the default **starting frame**, flag
   **identity references**. Starting frame = first frame of the video.
   Identity references are used only when an image model prepares a still.
3. **Prompts** – editable shared instructions (pre-filled, appended to every
   job) and a bulk box: blocks separated by `---`, first line = name, rest =
   motion prompt. Import/export the job list as JSON (`public/sample-jobs.json`
   - `public/sample-prompts.txt` are samples; "Load sample" button).
4. **Jobs** – per-job name, starting image override, motion prompt, optional
   starting-image prompt, duration (nearest supported to 4 s), resolution
   (480p if supported), optional aspect ratio and seed (only if the model
   supports them), include checkbox, and the **complete prompt that will be
   submitted**.
5. **Generate selected** → confirmation (provider, model, job count, estimated
   cost or **"Cost unavailable"**) → queue.

### Generation modes

- **A. Animate existing image** (default, cheapest): starting image + prompt go
  straight to the video model.
- **B. Suggest animations** (optional, paid helper): sends your default
  reference image to a vision chat model and returns prompt blocks into the bulk
  box for you to edit. Nothing is added until you parse it.
- **C. Prepare starting image, then animate**: an image model makes an
  action-specific still (add a mug, change pose, add headroom). The job stops at
  **Awaiting image approval**; you approve (or discard) before any video is paid
  for. Auto-chaining exists only behind an off-by-default checkbox.

Optional helper buttons (explicit clicks, never automatic): refine a motion
prompt for subtle ~5 s motion; suggest a starting-image prompt from the
reference. Suggestions are shown and only applied if you click **Use this**.

## Safety behaviour (avoiding double charges)

- State is saved to `data/state.json` **before** every paid call. The provider
  job ID is saved the instant it's known; polling resumes after refresh/restart.
- A submission is **never retried automatically**. A definite 4xx = `failed`
  (nothing started). A timeout / network drop / 5xx / unreadable reply, or a
  crash mid-submit = **Submission uncertain**: you must check your OpenRouter
  activity, then click "I checked — it was not submitted" before a retry is even
  possible.
- Polling and downloads retry with exponential backoff (honouring `Retry-After`).
  A failed download can be retried for free; the video stays at the provider.
- Double-clicks/refreshes can't queue a job twice (state checked atomically on
  the server). Retries need explicit confirmation.
- **Stop queued** returns waiting jobs to draft. Jobs already submitted can't be
  cancelled (OpenRouter documents no cancel call): they keep running and
  billing. The UI says so wherever it matters.
- Queued jobs survive a restart and resume (you confirmed them already).
- Keys: env var or a session-only key held in server memory. Never in URLs,
  logs, browser storage, or saved files; error text is redacted. The key is only
  ever sent to `openrouter.ai`.
- Uploaded images and prompts are treated as data; helper calls put instructions
  only in the system message.

## Results

Videos are saved to `data/outputs/` as `name-01.mp4` immediately after
generation. Each card shows an inline preview, actual format/size/content type,
reported cost, and a download button. **Download all (ZIP)** includes a
`manifest.json` (prompts, shared instructions, model, provider, settings, image
names, filenames, timestamps, provider job IDs, costs). Non-MP4 output is
reported as such and is not renamed.

## Mock mode

Clearly labelled in the UI and the confirmation dialog; makes no network calls
and costs nothing. Put these in a prompt to simulate behaviour: `[mock:reject]`
(refused), `[mock:uncertain]` (no response), `[mock:fail]` (fails while
generating). The "result" is a placeholder test pattern, not your character.
`MOCK_DELAY_MS` controls how long fake jobs take.

## Tests

```bash
npm test            # prompt parsing, JSON import, settings/cost estimates,
                    # queue concurrency, persistence/resume, uncertain
                    # submissions, retries, still approval
npm run typecheck
npm run format      # Prettier, print width 80
```

Tests use a fake provider and a temp directory; they never touch the network.

## Limitations / not supported

- **Cancelling** submitted jobs and **idempotency keys**: not offered by
  OpenRouter's video API, so not simulated.
- Cost estimates only cover simple per-second pricing; token-priced models show
  "Cost unavailable". Starting-image costs are shown only after generation.
- Video accepts one starting frame; identity references reach only the image
  model. No last-frame/end-pose control in the UI (some models support it).
- No transparent backgrounds and no seamless-loop guarantee; PowerPoint wants
  MP4 (H.264) — check the format badge on each result.
- Audio is requested off for models that can generate it.
- Single user, single process. Don't expose it to a network: there's no auth.
- Large images are base64-encoded into the request; keep references modest
  (default upload limit 10 MB, `MAX_UPLOAD_MB`).
- `next build` prints a file-tracing warning for the upload route; harmless for
  local use.

## Config (`.env.local`)

See `.env.example`: `OPENROUTER_API_KEY`, `MOCK_MODE`, `MAX_UPLOAD_MB`,
`POLL_INTERVAL_MS` (default 15000), `DATA_DIR` (default `./data`),
`ALLOWED_DEV_ORIGINS`.

### Opening it from another device

The dev server allows `localhost` and `192.168.*.*` by default, so
`http://<your-pc-ip>:3000` works from a phone/laptop on your home network (start
with `npm run dev -- -H 0.0.0.0` if it isn't reachable). Other hosts: set
`ALLOWED_DEV_ORIGINS`. **There is no login**: anyone who can reach the port can
use your API key and credits, so only do this on a network you trust.
