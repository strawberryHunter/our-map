# Supabase backend

- `migrations/` — database tables, row-level security, pairing functions (applied in order).
- `functions/summarize` — writes a memory's story from its stored photos + our memo (Claude).
- `functions/recommend` — suggests a date course from our memories (Claude + web search).
- `functions/_shared` — pure helpers used by both, tested in Node by `npm run verify`.

Deployed by `.github/workflows/deploy-backend.yml` on every push that changes this folder.
