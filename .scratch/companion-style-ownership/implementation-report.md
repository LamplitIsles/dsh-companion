# Companion stylesheet ownership implementation report

## Outcome

Implemented the complete `companion-style-ownership` spec and both tickets.

- Added a shared inline stylesheet mounting helper that creates each `<style>` element inside its owning Cordis effect, sets `data-plugin="@lamplitisles/dsh-companion"`, assigns stable package-scoped sheet identities, and removes the same element from the effect disposer.
- Moved the application bundle and settings bundle to that helper. The application sheet remains route-gated to `/companion` while settings styles are registered before the route check for every client route.
- Removed legacy DOM-ID deduplication, manual style disposer returns, and effect feature-detection branches. The existing Vite/Svelte build and `?inline` CSS imports remain unchanged.
- Updated the local Playwright fixture to use the shared lifecycle seam and added a focused browser test for ownership metadata, stable IDs, CSS payloads, legacy-ID absence, and disposer cleanup.

## Acceptance coverage

Ticket 01 is covered by the lifecycle helper and the focused browser test. Both generated sheets carry the package owner and package-scoped IDs (`application.css` and `settings.css`), contain their expected CSS, and disappear when the fixture effect disposers run. The existing client entry route branch remains unchanged, preserving settings-wide and application-route-only scope.

Ticket 02 is complete after auditing `README.md` and `AGENTS.md`. Neither file describes stylesheet ownership or a changed user, operator, or agent workflow, so no documentation or guidance update was needed.

## Verification

- `bun install --frozen-lockfile` — passed with the pinned DSH `0.1.2-rc.1` dependency family.
- `bun run typecheck` — passed.
- `bun run test` — passed: 15 files, 106 tests.
- `bunx playwright test tests/e2e/fixture.spec.ts -g 'stylesheet ownership' --config=.scratch/playwright-local.config.ts --workers=1 --reporter=dot` — passed: 2 projects (desktop and Pixel 7a).
- `bunx playwright test --config=.scratch/playwright-local.config.ts --workers=1 --reporter=dot` — passed: 72 tests, 2 intentional skips across desktop and Pixel 7a-sized Chromium.
- `bun run build` — passed: host declarations, client bundle, and wrapper generation.
- `bun run pack:check` — passed: build and publishable tarball dry-run.
- `git diff --check` — passed.
- `bun run test:dsh-link` — build passed, then the smoke was blocked by the documented environment guard: no fixed rc.1 DSH executable was available (`DSH_CLI` unset). No live profile or service was touched.

The browser checks used only the local Vite fixture, fixture-owned in-memory state, and the installed local Chrome executable via `.scratch/playwright-local.config.ts`; the repository config's `/run/current-system/sw/bin/chromium` path is not present on this host. Generated screenshot artifacts were restored after verification.

## Change size

Against the feature branch fixed point, excluding this report, generated artifacts, and the lockfile:

- Product code: 26 additions and 24 deletions (50 changed lines), above the 15–35 estimate because the shared lifecycle helper is a new CSS-free module and the old duplicate/manual lifecycle code is removed.
- Tests and fixture support: 49 additions and 5 deletions (54 changed lines), within the 20–55 estimate.
- Configuration/docs: 0 changed lines.
- Total: 104 changed lines, within the 35–105 estimate.

Code review and deployment remain outside this implementation run, as requested.
