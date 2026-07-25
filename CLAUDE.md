# CLAUDE.md

Guidance for Claude Code when working in this repo. For what the project *is* and how to run
it, see [README.md](README.md); this file is about editing the code safely.

## Commands

```sh
npm run dev            # dev server (localhost:5173)
npm run check          # svelte-check typecheck — RUN THIS before every commit
docker compose up -d --build   # production build; serves on 127.0.0.1:5180
node scripts/smoke-agent.mjs   # verify agent auth + settingSources isolation
node scripts/dump-messages.mjs <dir-with-photos>   # inspect raw Agent SDK message shapes
```

There is no test suite. `npm run check` (0 errors) plus a manual run is the bar.

## Architecture

SvelteKit 2 + Svelte 5, `adapter-node`. Server routes under `src/routes/api/` are the backend;
there is no separate service. Server-only logic lives in `src/lib/server/`:

- `db.ts` — SQLite via Node's built-in `node:sqlite` (no native dependency). Schema, migrations,
  and startup reconciliation are here.
- `agent/run.ts` — the `query()` wrapper (isolation, tool locking, JSON validate + one retry).
- `agent/identify.ts` / `agent/price.ts` — the two agent stages (prompts + zod schemas).
- `agent/sse.ts` — `agentStream()`: runs work as a server-side job and streams progress; the
  job completes even if the client disconnects.
- `dashboard.ts` — earnings aggregation + sample-data seeding.
- `images.ts` — `sharp` resize/thumbnail and EXIF/GPS stripping.

The listing page (`src/routes/listing/[id]/+page.svelte`) is the workhorse UI.

## Load-bearing invariants — do not break these

1. **`settingSources: []` on every `query()` call.** Without it the agent inherits the user's
   global `~/.claude/CLAUDE.md` and skills and writes listing copy in that voice. Enforced in
   `agent/run.ts`. After changing agent options or upgrading the SDK, run `smoke-agent.mjs`.

2. **Agent stages are server-side jobs, not client-orchestrated.** The one-click flow is a single
   `GET /api/listings/[id]/generate` that runs identify → price inside one `agentStream` job, so
   it finishes even if the tab closes. Do **not** reintroduce browser-side chaining of two
   requests — that was a bug (listings stuck at `identified` with no price). Individual
   `/identify` and `/price` routes exist only for manual re-runs.

3. **Origin/CSRF handling is split across two files and both are needed.** `docker-compose.yml`
   sets `HOST_HEADER`/`PROTOCOL_HEADER` (covers a reverse proxy); `vite.config.ts`
   `csrf.trustedOrigins` lists direct origins (covers direct port access, where adapter-node
   otherwise assumes `https`). **Change the published port → update both.**

4. **`BODY_SIZE_LIMIT=128M`** in `docker-compose.yml` — adapter-node defaults to 512K, which
   rejects a single phone photo.

5. **Startup reconciliation** (`db.ts`) resets any listing stuck at `identifying`/`pricing` on
   boot — a restart kills in-flight agent runs, so their status must be cleared or the UI spins
   forever. Keep it.

6. **Progress notes depend on an undocumented SDK detail** — tool calls arrive as `tool_use`
   content blocks nested inside `assistant` messages (see `agent/run.ts`). If notes go quiet
   after an SDK upgrade, run `dump-messages.mjs` and check whether the shape moved.

## Conventions

- **Keep it dependency-light.** SQLite is `node:sqlite` (no native build); charts are hand-rolled
  inline SVG/CSS (no charting lib). Don't add a heavy dependency without a strong reason.
- **Agent output voice rules live in the prompts** (`identify.ts`, `price.ts`), not in
  post-processing. The agent writes in the seller's voice, invents nothing not in the photos or
  the user's context box, and never writes meetup/pickup/payment language — that comes from the
  global meetup note (Settings). If descriptions regress, fix the prompt.
- **Auth is the same code path** whether via the mounted `~/.claude` credentials or
  `ANTHROPIC_API_KEY` — don't special-case it.
- **Sample data** (`is_sample = 1`) is dashboard-only and hidden from the listings grid.

## Never commit

- `data/` (the SQLite DB and uploaded photos) — gitignored; it contains real listings, photos,
  and the user's meetup note. Confirm `git status` shows no `data/` before committing.
- Anything with a real name, email, or physical location. The settings meetup-note placeholder
  and any example strings must stay generic.
