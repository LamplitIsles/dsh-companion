# dsh-companion

`@lamplitisles/dsh-companion` is a small, one-to-one Svelte surface for DeepSeek Harness (DSH). It keeps DSH's durable Workspace/Session/runtime contracts and adds a calm chat presentation at `/companion/`.

## Install and build

This repository uses Bun:

```sh
bun install
bun run typecheck
bun run test
bun run build
```

The publishable package contains the Host bundle, the browser bundle, the Cordis patch, declarations, and this README. To install a local build into a disposable or real DSH profile, pack it and use DSH's plugin manager:

```sh
bun run build
npm pack --pack-destination .
dsh plugin --profile web add ./lamplitisles-dsh-companion-0.1.0.tgz
```

The package is pinned to the deployed DSH `0.1.1-rc.2` contract family (Cordis `4.0.1`). It is intentionally not a compatibility layer for other DSH releases.

## Two surfaces

- `/` remains the stock DSH Web UI, including advanced navigation, ordinary Tool views, Kepos ImageGen's React view, and plugin settings.
- `/companion/` selects the lower-priority Companion root. It shows one configured Workspace and one remembered/recent Session, human and assistant chat, allowlisted ImageGen images, and finalized Kepos TTS voice messages. A small **高级 DSH** link returns to `/` with a full-page navigation so the two compositions do not leak into one another.

Typing `/compact` as the complete Companion input invokes DSH's Session command channel and keeps the continuity checkpoint invisible; other slash-prefixed text remains an ordinary message.

Messages sent during a reply use DSH's durable FIFO queue and remain separate turns. With an empty draft, the composer action stops the current reply without clearing queued messages; DSH resumes those messages in order after cancellation settles.

DSH continues to stream and persist model output internally, while Companion shows assistant text only after its message is finalized. The typing bubble gains a slowly rotating, non-repeating companion note after a 12-second wait; stopping or completing the reply clears that transient timer state.

The Companion deliberately does not include a Workspace picker, session list/new-chat flow, model or preset controls, permissions/approvals, reasoning, Trajectory, generic Tool cards, prompt-injection inspection, file upload, voice input, notifications, or multi-contact UI.

## Configuration and recovery

Open the native DSH plugin settings page on `/` and configure:

- one stable Workspace id;
- Companion and user display names;
- an optional bounded local avatar for each identity (PNG/JPEG/WebP/GIF, at most 5 MB, decoded dimensions at most 4096 px);
- the user's preferred form of address; and
- the default affinity for a new or explicitly reset relationship (integer 0–100).

The configured Workspace is resolved by id and the live Session cwd. A missing id, stale Session, failed open, send rejection, or lost connection is shown as a recovery state; the Companion never silently selects another Workspace. The settings card keeps staged edits after a rejected/conflicted write and provides native Discard/Save actions. Editing the default affinity does not rewrite an established relationship.

Mood, affinity, and signature are Host-owned state stored atomically under the configured Workspace at `.dsh/dsh-companion/state.json`. The Host validates and bounds every load and mutation. The Companion exposes only a read-only relationship RPC to the browser; the agent's narrow `companion_set_mood`, `companion_adjust_affinity`, and `companion_set_signature` Tools remain hidden from the chat timeline. Affinity movement is clamped to ±10 net per accepted turn, and the dynamic prompt context is bounded descriptive metadata—not instructions, permissions, or a score to maximize.

For Sessions in that configured Workspace only, the package replaces DSH basic compaction's final instruction with its fixed companion continuity checkpoint. Other Sessions and LLM calls are unchanged. A request that is otherwise eligible but no longer has DSH basic compaction's expected final message fails visibly, rather than applying the companion prompt to an unknown backend; the runtime instruction is the single source of truth for its wording.

The execution posture is fixed to `workspace-write` with escalation disabled. Operations requiring broader authority fail; no approval or permission picker is presented.

## Media dependencies

Images use the selected DSH Session attachment contract. Only assistant structured image blocks and successful/running/failed `kepos_image_generate` results are projected; unrelated Tool output is hidden. Object URLs are page-owned and revoked when replaced or unloaded. The stock `/` ImageGen renderer remains untouched.

Voice rows recognize exactly one finalized `[[tts:text]]...[[/tts:text]]` passage (fenced code and malformed/multiple passages are ignored; normalized text is limited to 240 Unicode code points). Synthesis calls the already-installed Kepos TTS RPC with the live Session id. A page-local cache shares preparation by Session and normalized text, requires user activation for playback, and always leaves a transcript fallback. No changes are made to the `kepos-tts` repository.

## Themes and device target

DSH's effective appearance is the only theme authority: light maps to the authored **Sticker Messenger** palette and dark maps to **Night Voyage**. The root updates in place on `theme/change`; it does not write a second preference or remount the timeline. Tailwind Preflight is omitted, utilities/components are prefixed, and Companion selectors are rooted at `#dsh-companion`, leaving `/` untouched.

The committed fixture and Playwright project cover desktop and Pixel 7a-sized Chromium geometry (412×915 CSS px, DPR 2.625, mobile UA/touch), including reduced-height composer behavior, IME/newline handling, scroll anchoring, overlays/Back, media states, both themes, and reduced motion. This is a **Pixel 7a-sized Chromium behavior** claim, not exhaustive physical-device certification.

## Verification

The local acceptance commands are:

```sh
bun run typecheck
bun run test
bunx playwright test --config=playwright.config.ts --workers=1
bun run pack:check
```

`pack:check` builds and inspects the publishable tarball. Deployment, Kosmos installation, production cutover, and code review are outside this repository change.
