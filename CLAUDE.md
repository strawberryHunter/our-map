# Project: OURS (repo: our-map)

Couple memory app: auto-discovered memories, AI stories, memory movies, today's memories, AI date courses. Expo (React Native), iOS + Android, one codebase. Two users per couple.
Backend: Supabase (Postgres + Storage + Realtime + Edge Functions `summarize`, `recommend`). See README.md for setup.

## Workflow
- Before coding: state the plan, the files you will touch, and what you will NOT change.
- Keep diffs small. One feature per change. No unrelated refactors.
- If a requirement is ambiguous, ask. Do not guess.
- "Done" means `npm run verify` passes. Paste its summary. A change without a test that would
  have caught the bug is not done.
- List anything stubbed, mocked, or left as TODO before saying done.

## Verify (verify/)
- `npm run verify` runs everything; `-- --quick` skips slow steps; `-- sync db` runs matching steps.
- Report: `verify/out/report.md`. Video frames and the recorded video land in `verify/out/` too.
- New logic goes in a pure module (no React Native / Deno imports) so it can be tested in Node, like
  `src/sync/cluster.ts`, `src/sync/exif.ts`, `src/lib/today.ts`, `src/video/timeline.ts`,
  `src/video/camera.ts`, `src/face/core.ts`, `supabase/functions/_shared/story.ts`, `course.ts`.
- The movie page (`src/video/storyHtml.ts`) only plays a precomputed plan; put movie logic in
  timeline.ts / camera.ts where it is tested.
- Native modules are swapped for fakes in `verify/mocks/` when testing `src/sync/sync.ts`.
  If sync.ts imports a new native package, add a fake there (the bundler refuses unmocked imports).
- When fixing a bug: first add a test that fails, then fix, then show it passing.

## Platform
- Every feature must work on both iOS and Android. If a library is single-platform, say so first.
- Check a library's maintenance (last release, New Architecture support) before adding it. Prefer fewer.
- Install with `npx expo install <pkg> -- --legacy-peer-deps` so versions match the Expo SDK.
- Never edit `ios/` or `android/` by hand; configure through `app.json` and config plugins.
- Every native permission needs a Korean reason string. Do not request permissions we don't use
  (`verify/tests/config.test.ts` checks both).
- Handle permission denial without crashing (photos, saving to gallery).

## Privacy
- Current design (decided): photos are uploaded downscaled (1600px) so the partner's phone can see
  them; up to 4 stored photos + our memo per memory go to the Claude API for the story; date
  recommendations send titles/places/memos (no photos) to Claude with web search; face embeddings
  (numbers, not images) are stored in the couple's DB rows. Everything is private to the couple by RLS.
- Place rule: only photo GPS or one of us may set a memory's place (`place_source` gps/manual).
  The AI never decides a place; a hand-set place is never overwritten.
- Every network call must be listed in `verify/privacy-allowlist.json` with what it sends.
  The privacy test fails on any unlisted one. Mention new entries in the PR description.
- No analytics or crash SDKs. No logging of locations, embeddings or image data.

## Data edge cases (tested in verify/tests/cluster.test.ts and sync.test.ts)
- Photos without GPS stay with their time neighbours; outings without any GPS are not on the map.
- Photos without a timestamp are ignored.
- Indoor GPS drift and single wild GPS fixes do not split an outing (median + look-ahead).
- Large libraries: sync reads at most 400 photos per run and continues next time.
- An outing that may still be going on (last photo < 3h ago) waits for the next run.

## Code
- TypeScript strict. No `any` without a reason. No silent catch (log or surface the error).
- Long-running work (face, upload, video) must not block the UI.
- Do not invent package APIs. Read the installed version's `.d.ts` in node_modules first.
