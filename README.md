# Fleabook

**Turn photos of your stuff into ready-to-paste Facebook Marketplace listings.**

Drop in a few photos → Claude identifies the item, writes the listing, and researches what it
actually sells for → the app lays out every Marketplace field with a copy button. You paste
into Facebook by hand. There's also a dashboard with earnings graphs and a GitHub-style
selling-streak heatmap.

Local-only, runs in Docker, authenticates with your own Claude subscription.

---

## Why it works this way

Facebook has no public API for person-to-person Marketplace listings. The Catalog/Commerce API
only reaches Marketplace for approved partner verticals (vehicles, real estate, jobs), and
browser automation against the listing form violates Meta's terms and risks your account.

So Fleabook doesn't try to post for you. Posting was never the slow part — typing the form
takes thirty seconds. Deciding *what* to type — what the thing is, how to describe it, what
it's worth — takes ten minutes. **That** is the part this automates. The last step is a
copy-paste you do yourself, which keeps it entirely within Facebook's rules.

## Features

- **Photo → listing in one click.** Identify + price run as a single job; the whole thing
  finishes server-side even if you close the tab.
- **Real pricing research.** Searches the web for used comparables, falls back to
  retail-minus-depreciation when comps are thin, and shows its reasoning and sources.
- **Seller-voice descriptions.** Written as the owner, not a photo caption — no "appears to
  be", no invented flaws, no made-up backstory.
- **Context box.** Tell Claude what the photos can't show ("the white one is sealed", a
  purchase link, "keep it short") and it feeds both identify and pricing.
- **Copy-per-field UI** mirroring Facebook's form exactly, with live character counters.
- **Configurable meetup note** appended to every description (set once in Settings).
- **EXIF/GPS stripped** from every upload — a photo taken at home won't leak your address.
- **Dashboard**: total earned, monthly earnings, listings-by-status, and a
  GitHub-style daily-earnings heatmap.

## Quickstart

### Docker (recommended)

```sh
docker compose up -d --build
```

Then open **http://127.0.0.1:5180**.

The port is bound to `127.0.0.1` on purpose — this app has no auth of its own and spends your
Claude subscription on every agent run, so it should not be exposed to a network.

### On the host (no Docker)

```sh
npm install
npm run dev
```

## Authentication

Fleabook uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which
authenticates with the credentials the Claude Code CLI already stored — **no API key needed**
if you're logged in with `claude`. Under Docker, that's why `~/.claude` is bind-mounted.

Two things to understand about that mount:

- **It's read-write, and it's the whole directory.** OAuth token refresh rewrites
  `.credentials.json`, and bind-mounting that single file breaks when the process replaces it
  via rename. So the directory is mounted, which means the container can write to your entire
  Claude Code config, conversation history included. If that's more access than you want, run
  on the host instead (`npm run dev`) — the SDK finds the same credentials natively.
- **It's for personal use.** Anthropic does not permit third-party developers to offer
  claude.ai login for their products. A tool you run on your own machine for your own listings
  isn't that — but if you ever share or expose it, switch to an API key: set `ANTHROPIC_API_KEY`
  (uncomment it in `docker-compose.yml`) and the same code path uses it.

## How a listing gets made

Two agent stages, deliberately separate, run back-to-back as one server-side job:

1. **Identify** (~15s, no web access) reads the photos and fills in title, description,
   category, condition, and flaws. Catching a misidentification here is cheap.
2. **Price** (3–5 minutes, searches the web) finds real used comparables, falls back to
   retail-minus-depreciation when comps are thin, and reports its basis, confidence, reasoning,
   and the URLs it opened.

Progress streams over SSE. The work is **not** tied to the browser — close the tab mid-run and
the result still lands in the database. Fire a listing, move to the next, come back later.

### On the price numbers

Web search reaches *asking* prices far more easily than completed sales (eBay's sold data is
mostly behind JS and login), and asking prices run high. The agent adjusts for that, but the
number is a starting point to negotiate from, not gospel — which is why the range, the
reasoning, and the sources sit right next to it, and the price field stays editable.

## Configuration

- **Meetup note** (Settings): a line appended to every description — where/how to meet. The
  agent is told never to write meetup/pickup/payment language itself, so this is the single
  source of it.
- **Port / origin**: default `127.0.0.1:5180`. Behind a reverse proxy, add your hostname's
  origin to `csrf.trustedOrigins` in `vite.config.ts` (see the comment there) or SvelteKit's
  CSRF check will reject uploads.

## Project layout

```
src/
  routes/                     SvelteKit pages + API routes
    dashboard/                earnings dashboard
    listing/[id]/             the workhorse: edit + copy fields, run the agent
  lib/
    server/
      db.ts                   sqlite via node:sqlite (no native dependency)
      images.ts               sharp: resize, thumbnail, EXIF/GPS strip
      categories.ts           curated Facebook category enum
      depreciation.ts         retention curves, passed into the pricing prompt
      dashboard.ts            earnings aggregation + sample-data seeding
      agent/
        run.ts                query() wrapper: isolation, tool locking, JSON validate + retry
        identify.ts           stage 1 prompt + schema
        price.ts              stage 2 prompt + schema
        sse.ts                progress streaming that survives client disconnect
scripts/
  smoke-agent.mjs             verifies auth + settingSources isolation
  dump-messages.mjs           prints raw Agent SDK message shapes
```

## Tech stack

SvelteKit 2 + Svelte 5, `adapter-node`. SQLite via Node's built-in `node:sqlite` (no native
build). `sharp` for images, `zod` for validating agent output, `@anthropic-ai/claude-agent-sdk`
for the model. Charts are hand-rolled inline SVG/CSS — no charting dependency.

## Gotchas worth knowing

- **`settingSources: []` is load-bearing.** Without it the agent inherits `~/.claude/CLAUDE.md`
  and any globally installed skills, and writes listing copy in that voice — a stylized global
  skill makes descriptions sound like it instead of like a normal seller. Run
  `node scripts/smoke-agent.mjs` to confirm isolation after changing agent options or upgrading
  the SDK.
- **Origin handling is split across two files, and both halves matter.** `docker-compose.yml`
  sets `HOST_HEADER`/`PROTOCOL_HEADER` so the origin is derived from request headers (covers a
  proxy); `vite.config.ts` also lists direct origins under `csrf.trustedOrigins` (covers direct
  port access, where `PROTOCOL_HEADER` is absent and adapter-node otherwise assumes `https`).
  Change the port and both files need updating.
- **`BODY_SIZE_LIMIT` defaults to 512K in adapter-node**, which rejects a single phone photo.
  `docker-compose.yml` raises it to 128M. Nothing that large is stored — uploads are downscaled
  to 1600px on arrival.
- **Agent restarts orphan in-flight runs.** A listing frozen at `identifying`/`pricing` after a
  restart is reset to a recoverable state on the next boot — no permanent zombies.
- **Progress notes depend on an undocumented SDK detail** — tool calls arrive as `tool_use`
  content blocks nested inside `assistant` messages. If notes go quiet after an SDK upgrade, run
  `node scripts/dump-messages.mjs <photo-dir>` and check whether the shape moved.

## License

MIT — see [LICENSE](LICENSE).
