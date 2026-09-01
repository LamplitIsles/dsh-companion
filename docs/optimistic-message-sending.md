# Optimistic message sending and visual continuity

This document records Companion's complete ordinary-message send model: how text and photos appear immediately, how the local echo becomes an authoritative queue or Chat contribution, how the UI avoids duplicates and flicker, and how failures restore user input safely.

It also records two production bugs found while implementing the model. The first was unstable keyed identity. The second was a real empty projection caused by independently published Session and Chat snapshots. Both lessons are part of the contract; fixing only one is insufficient.

## User-visible contract

An ordinary send must satisfy all of these invariants:

1. The composer clears immediately and remains usable for another message.
2. The submitted text and photos appear as a normal outgoing message, not a special loading card.
3. The outgoing message remains present exactly once through local echo, queue admission, and durable Chat publication.
4. The message row and text bubble retain one presentation identity throughout a successful handoff.
5. A rejected send disappears and its original text/photos return to the correct composer session.
6. Page-local image previews remain alive while any optimistic UI still uses them and are revoked after their last consumer retires.
7. A session change cannot restore a failed draft into another conversation or carry transient handoff state across sessions.

The guarantee is visual continuity, not offline delivery. Pending echoes are browser memory only; reload and reconnect rebuild from authoritative Session history.

## Runtime ownership

The send path has deliberately narrow owners:

| Layer | Responsibility |
| --- | --- |
| `Companion.svelte` | Captures the draft and image objects, clears the composer, restores only pre-controller failures, and applies the Session retirement result to draft/preview ownership. |
| `submitCompanionInput` | Calls `beginSubmission` before serialization, sends the exact request ID to `prompt`, and abandons the controller handle on serialization/carrier/admission failure. |
| DSH Session controller | Creates the official pending echo, chooses its placement, observes queue/durable correlation, and emits exactly one `observed` or `failed` retirement. |
| `SubmissionHandoff` | Bridges temporary holes between separately published Session and Chat snapshots without becoming a transport or persistence authority. |
| `projectConversation` | Deduplicates correlated sources and derives stable presentation identity while preserving authoritative item identity. |
| Svelte timeline | Keys a complete message unit by its presentation identity and renders its ordered text/image items. |

There must not be a second custom optimistic-send owner. In particular, Companion does not maintain a bespoke outbox, infer acknowledgements from matching text, or create a retry-card state machine.

## Identity model

One logical send has several legitimate identities. They must not be conflated.

| Identity | Meaning | Lifetime |
| --- | --- | --- |
| Session `requestId` | Correlation minted by `beginSubmission` and passed unchanged to `prompt` | Local submission through authoritative observation |
| Host/Chat `rpcId` | The same correlation echoed on queue and durable sources | Authoritative source lifetime |
| Authoritative item ID | Queue occurrence, Chat node, or attachment identity used for business data and loading | Owned by its authoritative source |
| `messageKey` | Presentation identity used to group/key one outgoing contribution | `submission:<requestId-or-rpcId>` for a correlated send |
| `projectionKey` | Identity of an individual projected item where needed | Item-specific |

The central rule is:

```text
correlated outgoing messageKey = submission:<rpcId>
```

The optimistic echo uses its `requestId`, which is the future `rpcId`. Queue and durable sources therefore derive the same `messageKey`. Uncorrelated replay/history continues to use its authoritative Chat identity.

Stable presentation identity does not replace authoritative identity. A durable attachment still uses its real attachment ID and loading path even though its containing message unit keeps the optimistic message key.

## Successful send lifecycle

### 1. Composer commit

`Companion.svelte` freezes the current text, image drafts, and originating Session ID. It then clears the composer and schedules the send. The Session ID and a local submission token prevent a later failure from restoring content into a different Session or overwriting newer input.

The UI owns restoration only until a Session submission exists. A missing bound Session or an invalid local command such as `/compact` with photos is a `CompanionPreControllerError` and is restored locally.

### 2. Official pending echo

`submitCompanionInput` calls `session.beginSubmission` before image serialization or `prompt`. This order matters: image encoding and network admission can take time, but the outgoing message must already be visible.

The call supplies:

- queue delivery mode;
- exact submitted text;
- browser preview metadata for each image; and
- the retirement callback.

The controller inserts a `pendingSubmissions` row synchronously and returns a request ID. The same ID is passed to `session.prompt` without translation.

### 3. Placement and authoritative admission

The Session controller decides where the echo belongs based on current Session state. An idle ordinary send appears in the transcript. A send made while an agent turn is active can move through the FIFO queue. The projection also understands correlated steering occurrences supplied by the authoritative Session model.

The visible source can therefore evolve as follows:

```text
idle: pending echo ───────────────────────────────> durable Chat node
busy: pending echo ──> queue occurrence ─────────> durable Chat node
```

At each point, request/RPC correlation suppresses older overlapping sources so the message renders once.

### 4. Cross-store handoff continuity

Session and Chat are separate external stores. They do not publish one atomic combined snapshot. The Session controller can remove a pending echo or queue occurrence before React receives the Chat snapshot containing the durable node.

Without an explicit bridge, a valid event sequence is:

```text
Session: pending/queue present ──> source removed ──────────────────>
Chat:    old snapshot            ─────────────────> durable appears
UI:      message visible         ──> empty gap ───> message visible
```

`SubmissionHandoff` prevents this gap. It remembers only official correlated pending/queue sources already observed in the active Session. It merges them into the projection until the Chat snapshot exposes the same RPC ID. When that durable correlation appears, the remembered source is discarded in the same projection that renders the durable contribution.

This buffer is presentation continuity state, not a second delivery authority:

- it does not create or send messages;
- it does not persist across reloads;
- it clears on Session change;
- it never matches by text/content;
- it drops a correlated `failed` retirement immediately; and
- it retains the official Session source unchanged rather than inventing a replacement object.

The current contract assumes that an observed correlated source will eventually appear in Chat unless the Session reports failure. If a future feature allows explicit removal of already-observed queue items, that terminal removal must also tell `SubmissionHandoff` to drop the correlation.

### 5. Durable takeover

`projectConversation` finds `rpcId` on durable user/steering nodes and derives the same `submission:<rpcId>` message key. It keeps the durable node ID and attachment IDs for authoritative work.

The Svelte keyed message unit therefore remains the same row. For a pure-text message, both the row and text bubble remain connected DOM nodes. For images, the containing message unit remains stable, but a page-local preview element may legitimately be replaced by a durable attachment element because its data source and URL ownership changed.

## Failure lifecycle

Failure handling depends on whether `beginSubmission` has established controller ownership.

### Before controller ownership

Examples include no bound Session or locally invalid command input. `Companion.svelte` restores the frozen text/photos only if the submission token and originating Session still match. Newer input remains intact.

### After controller ownership

Image serialization errors, transport failures, and identified Host rejection call the idempotent submission handle's `abandon` path. The Session retires the echo as `failed` and invokes the registered callback once.

That retirement performs two coordinated actions:

1. `SubmissionHandoff` removes the correlated remembered source so a failed echo cannot linger.
2. The composer retirement handler restores the originating text/photos and applies preview cleanup rules.

The async send rejection itself only announces failure. It must not independently retire or restore controller-owned state; doing so would create double restoration and URL lifetime races.

An `observed` retirement does not remove the continuity buffer prematurely. Chat correlation, not Session removal timing, completes successful visual takeover.

## Image ownership

Text and all images from one source contribution form one `messageKey`-grouped message unit. Optimistic images use browser-owned preview URLs; durable images use Session attachment identities.

The important ownership rules are:

- call `beginSubmission` before serializing images so previews appear immediately;
- keep the submitted `File` and preview URL alive through admission;
- do not duplicate optimistic and queue/durable images when their RPC IDs correlate;
- let retirement transfer or end preview ownership;
- keep an open lightbox's URL alive until the dialog releases it; and
- do not promise DOM identity for the image element when preview becomes durable.

The stable contract is one message row, one ordered image group, no duplicate media, and correct URL cleanup.

## Bugs encountered and what they taught us

### Content matching is not correlation

The retired implementation tried to infer takeover from message shape. Identical text, repeated sends, image serialization, queue placement, and uncertain transport outcomes make content matching ambiguous. The official request/RPC identity is the only handoff key.

### Stable keys solve remounts, not missing data

The first continuity bug used `submission:<requestId>` for the optimistic row but reverted to the durable Chat node ID after takeover. Svelte destroyed and recreated the complete row. Keeping `submission:<rpcId>` fixed this remount.

However, that fix did not solve the production flicker. Browser timing later showed a real sequence of `visible → absent → visible`: Session/queue removal was published roughly 1.24 seconds before the correlated Chat update. No key can preserve a row that is absent from the entire projected snapshot. Cross-store source retention was also required.

### “Atomic replacement” fixtures can give false confidence

The original fixture inserted the durable source and removed the optimistic source in one update. Production publishes Session and Chat independently, so the fixture could not express the failing interleaving.

The fixture test also located the optimistic row only after clicking send. If the message disappeared and returned before the locator resolved, the test captured the final row and passed. A useful flicker test must begin observing before the click or explicitly model every intermediate source snapshot.

### Animation and framework bridges were not the root cause

Reduced-motion mode, transition behavior, and bypassing the React-to-Svelte bridge did not explain the original keyed replacement. Later layer-by-layer tracing showed the second failure already existed in the projection input: both Session sources were gone while Chat was stale. UI animation can amplify a discontinuity, but it cannot repair an empty model.

## Diagnostic method for future regressions

Start at the exact user gesture, not after an optimistic row is found.

1. Fill a unique probe string.
2. Before clicking send, sample composer value and exact visible-message count.
3. Continue sampling through pending, queue, durable publication, and typing state.
4. Fail if any sample has an empty composer and zero visible copies after the first outgoing copy appears.
5. Record layer state using correlation IDs only: Session pending IDs, queue RPC IDs, Chat RPC IDs, and projected message keys. Do not log message content, credentials, or startup tokens.
6. Remove all diagnostic logging after locating the first layer that loses the message.

The production failure trace was effectively:

```text
pending=1 queue=0 chat=old projected=present
pending=1 queue=1 chat=old projected=present
pending=0 queue=1 chat=old projected=present
pending=0 queue=0 chat=old projected=ABSENT
pending=0 queue=0 chat=new projected=present
```

After the handoff fix, the composer cleared at about 98 ms and the exact message count remained one for the full 3.2-second browser sample.

Live probing is a manual diagnostic/smoke technique only. Automated tests must use fixture-owned state and must never send messages through the user's real Session or touch the live profile.

## Regression coverage

The tests protect different seams rather than repeating the same assertion:

- `tests/composer.test.ts` verifies echo registration precedes prompt admission, the exact request ID reaches `prompt`, and retirement reports its correlated ID.
- `tests/projection.test.ts` verifies pending, queue, steering, and durable sources deduplicate into one stable `submission:<rpcId>` message unit while authoritative IDs remain intact.
- `tests/message-handoff.test.ts` explicitly models an idle Session→Chat hole, a pending→queue→Chat hole, and failed-retirement cleanup.
- `tests/e2e/fixture.spec.ts` captures the original optimistic row and text bubble and proves those same DOM elements remain connected across durable confirmation.
- Existing image cases verify text/image grouping, durable attachment takeover, preview lifetime, and eventual URL revocation.

When changing this path, test all of these observable states:

- idle text send;
- send during an active reply;
- consecutive sends;
- text with multiple images;
- identified rejection;
- browser-side image serialization failure;
- Session switch during an in-flight send;
- correlated queue/steering overlap;
- durable takeover; and
- image preview cleanup after retirement/lightbox close.

Do not assert source text or implementation shape. Assert visibility count, stable message-unit identity, connected DOM handles, restored user input, and owned resource cleanup.

## Verification and local deployment

Use the repository-selected commands:

```sh
bun run typecheck
bun run test
bun run build
bunx playwright test --config=playwright.config.ts --workers=1
```

Use `bun run test`, not `bun test`: the former invokes the configured Vitest suite, while the latter lets Bun discover the Playwright spec as a unit test and fails for the wrong reason.

For the linked host-local DSH web profile, deployment authority is:

```sh
just deploy-local
```

The recipe validates the local link, builds the package, restarts `dsh.service`, and waits for `/companion/` readiness. A successful PR merge alone does not deploy the UI.

## Change checklist

Before merging a change to ordinary sending, confirm:

- `beginSubmission` still occurs before serialization and prompt;
- `prompt` receives the exact returned request ID;
- no content-shape matching or second optimistic overlay was introduced;
- pending, queue, and durable contributions share `submission:<rpcId>`;
- authoritative node, projection, and attachment IDs remain authoritative;
- Session and Chat publication holes retain one visible source;
- failed retirement clears retained handoff state and restores only the originating composer;
- text remains present exactly once;
- the original text row/bubble stay connected on successful takeover;
- optimistic preview URLs remain valid until their last consumer releases them;
- session changes clear transient continuity state;
- unit, browser, build, and type checks pass; and
- the documented deployment command succeeds when deployment is in scope.

## Relevant implementation files

- `src/client/Companion.svelte` — composer commit, restoration, and retirement handling.
- `src/client/admission.ts` — official Session echo registration and prompt correlation.
- `src/client/submission-handoff.ts` — Session/Chat publication-gap bridge.
- `src/client/CompanionRoot.tsx` — external-store subscription, projection assembly, and correlated retirement wiring.
- `src/projection.ts` — correlation, deduplication, item projection, and message-unit grouping.
- `src/client/CompanionBridge.svelte` — React-to-Svelte props bridge.
- `tests/composer.test.ts` — admission and retirement contract.
- `tests/projection.test.ts` — correlated projection contract.
- `tests/message-handoff.test.ts` — independently published snapshot interleavings.
- `tests/e2e/fixture.spec.ts` and `fixture/main.ts` — rendered continuity and image-lifecycle coverage.

## Explicit non-goals

This design does not provide a persisted outbox, offline sends, delivery receipts, manual retry cards, cross-device optimistic synchronization, or optimistic echo restoration after page reload. Those features require a different durable product contract and must not be approximated by extending the presentation handoff buffer.
