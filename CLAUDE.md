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
node scripts/build-windows.mjs # package dist-windows/ (needs Go, makensis, network)
node scripts/build-windows.mjs --no-installer      # ...without the NSIS step
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
- `auth.ts` — resolves the credentials handed to the agent (env key → stored key → OAuth).

The Windows package is built by `scripts/build-windows.mjs` from `windows/launcher` (a Go
program: stdlib plus `go-webview2`) and `windows/installer` (an NSIS script), on top of a
pinned Node runtime. It emits an installer, the unpacked folder, and a portable zip. It is
additive: nothing under `windows/` is reachable from the Linux or Docker path.

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
   otherwise assumes `https`). **Change the published port → update both** — and note the
   Windows launcher pins 5180 for exactly this reason. It refuses to start on a different port
   rather than silently landing outside `trustedOrigins` and 403-ing every upload, so a port
   change is now a three-file change.

4. **`BODY_SIZE_LIMIT=128M`** — adapter-node defaults to 512K, which rejects a single phone
   photo. Set in **two** places that don't read each other: `docker-compose.yml` for the Linux
   path and `windows/launcher/main.go` for the Windows one. Changing one without the other
   leaves that platform silently unable to accept uploads.

5. **Startup reconciliation** (`db.ts`) resets any listing stuck at `identifying`/`pricing` on
   boot — a restart kills in-flight agent runs, so their status must be cleared or the UI spins
   forever. Keep it.

6. **Progress notes depend on an undocumented SDK detail** — tool calls arrive as `tool_use`
   content blocks nested inside `assistant` messages (see `agent/run.ts`). If notes go quiet
   after an SDK upgrade, run `dump-messages.mjs` and check whether the shape moved. Token
   usage rides on the same class of dependency: `readUsage()` picks `usage` and
   `total_cost_usd` off the `result` message. Both read defensively and degrade to zero
   rather than throwing — usage is cosmetic and must never take a listing's run down with
   it — so the symptom of a shape change is a flat dashboard, not an error.

7. **`agentEnv()` is passed explicitly to `query()`, not inherited.** That is what lets a key
   saved in Settings work identically to one exported by Compose. Keep the precedence in
   `auth.ts` (env → stored → OAuth) and keep it in one place — the agent must never branch on
   which source won. The env-var-wins ordering is a safety property, not a preference: without
   it, anyone who can reach the web UI of a deployed instance could repoint it at their own key.

8. **Agent cost is always shown; the wording is what distinguishes a charge from an
   estimate.** The SDK reports `total_cost_usd` for subscription runs too, where it is a
   list-price estimate rather than a bill. That number is worth showing either way — it is
   how you compare a plan against an API key — but labelling it "API cost" for a Pro/Max
   user invents a charge they never received. `costKind()` in `server/usage.ts` selects the
   copy ("API cost / billed to your API key" vs "Token value / at API rates — covered by
   your plan"); it must never be reduced to a bare "Cost". `agent_runs.auth_mode` records
   which credential paid each run, so when history spans a switch the tile can say how much
   of the total was actually billed rather than presenting one number that is neither.

9. **A seller who prices the item in the context box gets no price research.** Pricing is the
   expensive stage — Opus, web search, minutes — so running it against someone who already
   decided burns real money to produce a number that gets overwritten, and one that lands low
   is worse than useless. The directive is read *during identify* (`price_directive` /
   `seller_price` in `identify.ts`), where the notes and photos are already in context and it
   costs nothing; `generate/+server.ts` then branches before stage 2 and applies
   `sellerPricePatch()`. Resolving a *number* is strongly preferred over merely skipping —
   `seller_set` both saves the research and fills the price in, where `no_research` leaves the
   field empty. (That enum value is deliberately not called `skip`: sellers write "skip the
   pricing analysis" next to a price, and an option spelled the same as their own word pulls
   the model onto it.) `price.ts` carries the same rule as a second line of defence, for the
   manual "Re-price only" path and for when identify misreads. Keep both: identify's copy is
   what saves the tokens, price's is what stops a bad number. `ai_price_basis = 'seller'`
   marks these rows, and the UI says "priced by you — no research run" — a silent skip is
   indistinguishable from a stage that crashed.

10. **`agent_runs` is a spend ledger and outlives the listings it describes.** It deliberately
    carries no foreign key onto `listings`: a run that cost real money and produced a listing
    you deleted is precisely the row worth seeing, and the `ON DELETE CASCADE` this table
    shipped with erased it. Do not re-add one, and do not "clean up orphans". `listing_title`
    is snapshotted — on insert, and again in `deleteListing()` for rows that were still null
    because identify runs are recorded before a listing has a title. `agentUsage()` prefers the
    live title and falls back to the snapshot. `migrateAgentRuns()` in `db.ts` rebuilds the
    table (the FK is part of the definition, so ALTER cannot do it) and is keyed on the
    `listing_title` column being absent.

11. **The Windows launcher has no console, so `fmt.Println` goes nowhere.** It is linked with
    `-H=windowsgui` (`build-windows.mjs`) because a console flashing up behind an app window
    reads as broken software. Two channels replace it and they are not interchangeable:
    `alert()` (a message box) for the handful of things a non-technical user must act on, and
    `logf()` → `%LOCALAPPDATA%\Fleabook\logs\fleabook.log` for everything else, including
    Node's own stdout/stderr. A failure before the window exists can only be reported by
    `alert()`; a failure after it exists should render into the window via `errorHTML()`,
    because a message box over a blank window says less than the window could. `logSink` is
    nil until `startLogging()` succeeds — assign it to `cmd.Stdout` only when non-nil, since a
    typed-nil `*os.File` in an `io.Writer` is not a nil interface and `os/exec` will write to it.

12. **The window is WebView2, which means there is no address bar and no browser fallback for
    anything the page does.** Two consequences. External links: a `target="_blank"` would open
    a second chromeless window with no way back, so `externalLinkScript` intercepts clicks
    leaving the app's origin and hands them to the real browser through the bound
    `fleabookOpenExternal` — which validates the scheme, because `rundll32`'s
    `FileProtocolHandler` acts on far more than http. `Bind` works by injecting at document
    creation, so it must be called before the first navigation. And identity: the icon, the
    version block and the DPI/UAC manifest all come from the **committed**
    `windows/launcher/resource_windows_amd64.syso`, linked by filename with no build step —
    regenerate it (`windows/resources/README.md`) after changing the icon, the manifest, or
    the version in `package.json`, or the executable keeps claiming the old one.

13. **The installer is per-user by construction — keep it that way.** `RequestExecutionLevel
    user`, `$LOCALAPPDATA\Programs\Fleabook`, uninstall entry in HKCU. Nothing writes to
    HKLM or Program Files, which is what keeps the install free of a UAC prompt; the people
    this build is for are frequently not administrators of the machine they are installing on,
    and an elevation prompt is where they stop. The manifest's `asInvoker` is the same
    property enforced from the other side. Stopping a running copy is `taskkill /IM
    Fleabook.exe` **only** — never `node.exe`, which would kill unrelated Node processes; the
    launcher's job object is what takes the server down with it, so invariant 5's reconciliation
    and this both depend on that job object surviving.

## Conventions

- **Keep it dependency-light.** SQLite is `node:sqlite` (no native build); charts are hand-rolled
  inline SVG/CSS (no charting lib). Don't add a heavy dependency without a strong reason.
- **The launcher's one dependency must stay cgo-free.** `go-webview2` is pure Go on purpose:
  the package is cross-compiled from Linux with `CGO_ENABLED=0`, so anything needing a C
  toolchain would move the Windows build onto a Windows machine. Same for the installer — NSIS
  was chosen over Inno Setup because `makensis` runs natively on Linux.
- **Agent output voice rules live in the prompts** (`identify.ts`, `price.ts`), not in
  post-processing. The agent writes in the seller's voice, invents nothing not in the photos or
  the user's context box, and never writes meetup/pickup/payment language — that comes from the
  global meetup note (Settings). If descriptions regress, fix the prompt.
- **Auth is the same code path** whether via the mounted `~/.claude` credentials or
  `ANTHROPIC_API_KEY` — don't special-case it.
- **Sample data** (`is_sample = 1`) is dashboard-only and hidden from the listings grid.

## Never commit

- `data/` (the SQLite DB and uploaded photos) — gitignored; it contains real listings, photos,
  the user's meetup note, and — since the Settings API-key field — possibly a live Anthropic API
  key in plain text. Confirm `git status` shows no `data/` before committing.
- `dist-windows/` and `.cache/` — build output and the downloaded Node runtime. Gitignored.
- Anything with a real name, email, or physical location. The settings meetup-note placeholder
  and any example strings must stay generic.
