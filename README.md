# Asset Away

A local, single-user workspace for producing a consistent set of presentation
assets: **a style → a batch of images → animations of those images → export**
(PNG, MP4, transparent GIF/WebM, on any exact background colour).

Built for things like a mascot in many poses, but it works for icon sets and
illustration styles too. Everything runs on your machine; only provider calls
leave it. Next.js + TypeScript + Tailwind, JSON + files on disk, no database.

## Quick start

```bash
npm install
brew install ffmpeg          # needed for background colours, GIF, WebM
cp .env.example .env.local   # then put your OpenRouter key in it
npm run dev                  # http://localhost:3000
```

No key yet? Open **Settings** and tick **Mock mode** (or start with
`MOCK_MODE=1 npm run dev`) to try the whole flow for free.

> An OpenRouter **API key is separate from any chat subscription** (Claude,
> ChatGPT…). Create one at <https://openrouter.ai/keys> and add credits. That one
> key runs everything: images, videos and the prompt helpers. (fal.ai is not
> used: OpenRouter has a documented image-to-video API.)

## The flow

The top bar has a **project** switcher (one project = one style, e.g. “Coco
mascot”) and four tabs. Old batches stay out of the way; find anything later in
the Library.

1. **Style** – describe the asset and its style, set style rules and motion
   rules, upload reference images and pick the ★ **style anchor** (sent with
   every image request so new images match). No reference yet? Create concept
   cards from your description.
2. **Images** – _Suggest poses_ (a vision model proposes N poses from your
   anchor), _Paste prompts_ (`name`, prompt, `---` between blocks), or add cards
   by hand. Prompts are **editable draft cards**: review them, then _Generate
   selected_ (a confirmation shows models and cost). Results land in a batch
   (newest open, older collapsed). **Review** every result: Keep ✓, Reject ✗ or
   Regenerate ↻, one by one or in the full-screen viewer (←/→, **K** keep, **X**
   reject, side-by-side with the anchor, any background colour). Nothing moves
   on until you keep it.
3. **Animations** – pick a kept image, **Prepare green screen** (see below),
   then _Suggest animations_: for each idea the helper also recommends a
   **duration, aspect ratio and loop / no-loop** that fit the motion (a wave is a
   short square loop; a walk is longer, landscape, no loop; a peek plays once).
   They show as ✨ “Auto” values you can override. Generate, review, keep.
4. **Library & Export** – every kept (or to-review/rejected) image and clip,
   filterable by type, status, batch, source image and text. Tick items, pick a
   **background** (transparent or any colour; save your brand colours like
   `#e60167`), pick formats, **Download ZIP** (with `manifest.json`).

## Backgrounds, transparency and loops (what is real)

- **Images** can be requested with a real alpha channel on models that support
  it (OpenAI gpt-image family, Sourceful Riverflow; the model picker labels
  them). Other models draw on flat green and the green is **keyed out locally**.
  If a “transparent” model returns an opaque image the card shows a warning.
- **Video models cannot output transparency.** So clips are made on a flat key
  colour (green) and keyed out locally with ffmpeg. That is also how a clip gets
  your exact brand colour: key out the green, composite onto `#e60167`.
- The green-screen first frame is made once per image, by compositing a
  transparent PNG onto green (free, local) or, for opaque images, one
  image-model call that you review before use. For wide aspect ratios the plate
  is extended with extra green margin locally (the subject is never cropped).
- **Colour accuracy (measured):** PNG is pixel-exact. MP4 is within a few
  levels (H.264 4:2:0 cannot be bit-exact; tagged BT.709). GIF is palette
  quantised (±1). **GIF transparency is on/off only**, so soft edges become
  slightly jagged; WebM has true alpha but PowerPoint can’t play WebM.
- **Loops:** 15 of the 26 video models accept a last frame; for those a loop
  sends the same image as first _and_ last frame (a genuine seamless loop). For
  the others the prompt asks for a return to the start pose (best effort, flagged
  on the card). On export, **ping-pong** can make any clip loop.
- Keying quality depends on the model keeping the green flat. If you see green
  fringes or holes, change **Edge tolerance** in the export panel and preview it
  in the viewer first.

## Troubleshooting a clip that “jumps” in its first frames

Video models treat the first frame literally, then re-render everything, so a
mismatch between the first frame and your prompt shows up as a pop in frames
1–3. Common causes, and what the app does about them:

- **A green background in your wording but not in the first frame** (e.g. motion
  rules saying “make the background chromatic green” while _Animate on a green
  screen_ is off). The app now **blocks** this with an explanation. Turn the
  green screen on (the first frame then _is_ green) or remove that wording.
- **A transparent first image.** Video models can’t use transparency, so it is
  placed on white (or your brand colour if the project background is a colour)
  before sending. Earlier versions could turn transparent pixels **black** when a
  target aspect ratio was set; fixed, with a regression test.
- **Residual re-rendering.** Use **Clip options → Skip first frames** when
  exporting.
- **Audio.** Some models (e.g. Grok Imagine) add an audio track even though
  none was requested. MP4/GIF/WebM exports are always silent; “Original files”
  keeps whatever the model produced.

## What was verified against OpenRouter’s docs

| Capability                    | Result                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Image → video                 | `POST /api/v1/videos`, poll `GET /api/v1/videos/{id}`, download `…/content`. First/last frame via `frame_images`.           |
| Models, prices, capabilities  | Live from `GET /api/v1/videos/models` and `/api/v1/images/models` (transparency, reference count, durations, ratios, SKUs). |
| Image generation + references | `POST /api/v1/images` with base64 `input_references` and `background: "transparent"` where supported.                       |
| Idempotency keys              | **None documented** for video or images.                                                                                    |
| Cancelling a submitted job    | **No cancel call documented.**                                                                                              |

## Safety behaviour (avoiding double charges)

- State is saved to `data/state.json` **before** every paid call. A video’s
  provider job id is saved the instant it is known; polling resumes after a
  refresh or restart.
- A paid request is **never retried automatically**. A definite 4xx = failed
  (nothing started). A timeout / dropped connection / 5xx / crash mid-request =
  **Submission uncertain**: check your OpenRouter activity, then confirm before a
  retry is even possible.
- Polling and downloads retry with backoff. A paid image/video is **always
  saved**, even if local post-processing (keying) fails. A failed download can be
  retried for free.
- Double-clicks and refreshes cannot queue an item twice. Retries need
  confirmation. **Stop queued** returns waiting items to draft; submitted
  requests can’t be cancelled and keep billing (the UI says so).
- Keys: env var or a session-only key in server memory. Never in URLs, logs,
  browser storage or saved files; errors are redacted; the key is only sent to
  `openrouter.ai`. Prompts and images are treated as data in helper calls.

## Files

Everything is under `data/` (git-ignored): `state.json` (projects, batches,
items), `images/`, `outputs/` (raw clips), `exports/` (cached renders).
Delete `exports/` any time to reclaim space.

**Upgrading from the first version:** on first start, the old `state.json` is
backed up to `state.json.v1.bak` and your images and finished videos are carried
into a project called “Imported” (drafts and failed jobs are not). Imported
clips weren’t made on a green screen, so they download as-is but can’t be
recoloured.

## Mock mode

Clearly labelled in the UI and dialogs; no network, no cost. Placeholder art
(a green-screen clip and transparent images) so the whole pipeline, including
keying and export, can be tried. Put `[mock:reject]`, `[mock:uncertain]` or
`[mock:fail]` in a prompt to simulate failures.

## Tests

```bash
npm test            # 77 tests: queue concurrency, persistence/resume, uncertain
                    # submissions, retries, planner, v1 migration, helper
                    # parsing, and a real-ffmpeg pipeline (keying, exact brand
                    # colour compositing, transparent GIF/WebM alpha)
npm run typecheck
npm run format      # Prettier, print width 80
```

## Config (`.env.local`)

`OPENROUTER_API_KEY`, `MOCK_MODE`, `MAX_UPLOAD_MB`, `POLL_INTERVAL_MS` (default
15000), `DATA_DIR` (default `./data`), `ALLOWED_DEV_ORIGINS`. The dev server
allows `localhost` and `192.168.*.*`. **There is no login**: don’t expose the
port on a network you don’t trust.

## Limitations

- OpenRouter has no cancel/idempotency for video; costs for images are only
  known after generation; token-priced video models show “Cost unavailable”.
- Video takes one starting image (no multi-reference); identity is carried by
  the green-screen first frame.
- AI backgrounds are never exactly your colour; exact colours come from the
  local compositing step.
- Single user, single process; no auth.
- `next build` prints a file-tracing warning for the upload route; harmless
  locally.
