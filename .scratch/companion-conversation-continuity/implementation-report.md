# Companion conversation continuity implementation report

## Outcome

Implemented the complete Companion conversation-continuity slice, including the in-scope desktop drawer persistence and `/compact` composer completion work.

- Added the public token-meter and compaction event type dependencies at the pinned `0.1.1-rc.2` versions; token-meter is declared in both `devDependencies` and `peerDependencies` because published declarations re-export its client type.
- Registered a session-scoped public conversation lifecycle definition/view for `compaction/start` and `compaction/end`.
- Projected trustworthy `contextPressure` values into an optional 28px capacity ring and accessible `对话容量` popover.
- Added live `整理记忆` running/completed/failed status copy with eight-second terminal visibility and reduced-motion styling.
- Added one durable, non-expandable static/non-live `整理记录` per successful compaction, using only the safe rounded `shadowedTokenCount` evidence and never rendering the private summary. The short-lived lifecycle status remains the sole live announcement.
- Bridged the lifecycle and pressure views through `CompanionRoot` and added deterministic fixture controls for browser verification.
- Completed desktop drawer preference persistence, mobile non-persistence, slash filtering, pointer acceptance, and IME-safe Tab/Enter completion.
- Added the in-scope [CONTEXT.md](../../CONTEXT.md) vocabulary source to the feature commit.

## Acceptance coverage

Ticket 01 is covered by storage-guarded desktop restoration, transient mobile drawer behavior, exact `/compact` filtering and acceptance, and ordinary-message/IME non-interference checks.

Ticket 02 is covered by projected-pressure fallback and validation tests, lifecycle ordering/idempotency/expiry behavior, private-summary exclusion, optional capacity presentation, keyboard/outside popover behavior, terminal status expiry, both authored themes, Pixel-sized layout, reduced-motion behavior, and the static-history/live-status accessibility regression check.

## Review corrections

Against fixed point `c5baf1802ca07141827c0c3c09dd269f9cb092be`, the implementation now also removes the obsolete `resolveContextPressure` alias and `isCompactionSummaryNode` export/import, returns an idempotent composite disposer from `registerCompanionContinuity`, and attaches that disposer to the client plugin context lifetime. A focused unit probe verifies both registry keys are removed on disposal and can be registered again without duplicates.

## Verification

- `bun run typecheck` — passed.
- `bunx vitest run` — 8 files, 53 tests passed.
- `bun run build` — TypeScript declaration, host bundle, client bundle, and fixture assets built successfully.
- `bunx playwright test tests/e2e/fixture.spec.ts --project=desktop --project=pixel-7a --workers=1 --reporter=dot` — 31 passed, 1 skipped (the existing desktop-only geometry test is skipped for Pixel 7a).

The browser suite uses only its local Vite fixture, fixture-owned browser storage, and in-memory props; it does not access live DSH sessions, profiles, credentials, or configuration. Generated screenshot outputs were restored after verification.

## Change size

Against the fixed-point branch, excluding this report, the lockfile, and generated artifacts, the implementation is 827 additions and 23 deletions (850 changed lines). This is above the 430–715-line estimate because the public registry seam requires an explicit lifecycle state machine, privacy-safe evidence adapter, and session-view bridge, while the requested desktop/mobile/theme/reduced-motion acceptance adds corresponding fixture coverage. No optional threshold, provider, or diagnostic surface was added.
