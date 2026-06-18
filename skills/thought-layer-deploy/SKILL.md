---
name: thought-layer-deploy
description: "Take the built site live to a user-owned URL with no lock-in, the last step after the build. Reads .thought-layer/build.json (publish dir + entry) next to the state file, then deploys to Netlify by one of two BYOK models: with NETLIFY_AUTH_TOKEN set it deploys into the user's OWN account via the file-digest API (owned immediately, no claim); with no token it uses the user's Netlify CLI (logged in: a site in their account; logged out: an anonymous, claimable URL with a one-hour claim link). When build.json declares a backend it ships automatically: functions go up via the user's Netlify CLI and the declared env var names are set on the site (values read only from the environment, BYOK). DATABASE_URL is bring-your-own by default; provisionDb and applySchema are opt in; staticOnly ships just the front end. Prefers the deploy tool (Pi) or the tl deploy CLI. Run it after thought-layer-build (or tl_scaffold) has produced build.json."
---

# Deploy it: the build goes live to a URL you own

This is the last step of the loop: rigor -> spec -> build -> **a live, owned URL**. You are not writing a deploy script by hand; you run the kit's deploy tool, which reads the build manifest and takes the publish directory live. BYOK, nothing phones a central account, no lock-in.

## Precondition: a build must exist

The deploy reads `.thought-layer/build.json` (written by the **thought-layer-build** skill or the **tl_scaffold** tool), co-located with the state file. Honor the same selection as the rest of the kit: an explicit `--path` / tool `path` wins, then `THOUGHT_LAYER_STATE`, then the default `.thought-layer/state.json`.

- **Required:** a `build.json` with a `publishDir` that exists on disk. If it is missing, **stop** and point the user at `/tl-build` (full build) or the `tl_scaffold` tool (an instant deployable landing floor). Do not invent a publish dir.
- `build.json.publishDir` + `entry` are load-bearing; `hasBackend` decides the static-only warning below.

## How to run it

Use the tool, never a hand-written `curl`/`netlify` invocation:
- **Pi:** the `deploy` tool. Start with `deploy { dryRun: true }` to show the plan, then `deploy {}` to go live (add `anonymous: true` to force the no-account path, `siteId` to re-deploy to the same site).
- **Any shell agent (Claude Code, CI, a plain terminal):** `tl deploy` (via `npx -y @hobocode/thought-layer tl deploy`). Use `--dry-run` first, then `tl deploy`. Flags: `--anonymous`, `--name <slug>`, `--site <id>`, `--path <file>`.

Always **dry-run first** and show the user the file list and the target, then deploy.

## The two models (both keep ownership with the user)

The tool picks automatically; explain which one ran.

- **BYO token (the default when `NETLIFY_AUTH_TOKEN` is set).** Deploys straight into the user's own Netlify account via the file-digest API (no zip, no extra dependency). The site is theirs from the first second - **no claim step**. Re-deploy to the same site with `--site <id>` (the id is in the deploy output and `deploy.json`). The token is read **only from the environment** - never ask the user to paste it into the chat, and never put it in a tool parameter or a file.
- **Netlify CLI (when no token is set).** Delegates to the user's installed Netlify CLI, and branches on the CLI's own login state (a logged-in CLI ignores `--allow-anonymous`, so the tool checks):
  - **logged in** -> creates a new site in the user's own account (`--create-site`, owned immediately, **no claim**), or re-deploys to `--site <id>`.
  - **logged out** -> an **anonymous, claimable** site (`--allow-anonymous`) with a **one-hour claim link** that transfers ownership to whatever account the user logs into. We never reverse-engineer that handshake; it needs a current CLI (`npm i -g netlify-cli@latest`; the flag shipped 2026-03).

If neither a token nor a usable CLI is available, relay the tool's guidance honestly (set a token, install/update the CLI, or drag the publish dir onto https://app.netlify.com/drop) instead of pretending it deployed. If the user explicitly asked for an anonymous deploy but the CLI is logged in, the tool says it went to their account instead and that `netlify logout` first would make it anonymous - pass that on.

## Backend deploy (automatic; static stays the floor)

If `build.json.hasBackend` is `true` and the build declared a serverless backend, the tool ships it **automatically** alongside the static front end:
- **Functions** go up via the user's **Netlify CLI** (it bundles the TypeScript). The CLI is required to ship functions; if it is missing but a token is set, the tool takes the front end live, sets the env vars, and tells the user plainly that functions need the CLI (it does not pretend they shipped).
- **Env vars**: the declared names are set on the site. Values are read **only from the environment** (BYOK), set via the Netlify API when a token is present (secret-capable) or imported via the CLI otherwise. A declared name that is absent from the environment is reported by name so the user can set it and re-run. Never ask the user to paste a value into the chat.
- **Database**: `DATABASE_URL` is **bring-your-own** by default (the tool also reads `NETLIFY_DATABASE_URL` / `NETLIFY_DATABASE_URL_UNPOOLED`). Two opt-in flags go further: `--provision-db` / `provisionDb` provisions Neon with the user's own `NEON_API_KEY`, and `--apply-schema` / `applySchema` applies `schema.sql` with `psql`. Both are off by default.
- **`--static-only` / `staticOnly`** ships just the front end even when a backend is present; the tool then points at `BACKEND.md` for the manual steps.

Relay what actually happened: which site got the backend, which functions shipped, which env names were set versus missing. Do not imply a backend is running when it is not (for example, when only the front end shipped because the CLI was absent).

## After it is live

Report, plainly:
- the **live URL**, and (anonymous only) the **claim link** with the one-hour window called out;
- for the token path, that it is already owned by their account and how to re-deploy (`--site <id>`);
- that a `.thought-layer/deploy.json` record was written (URL, mode, site/deploy ids) next to `build.json`.

If the tool returned `ok: false`, do not claim success - surface its message (the next honest step) verbatim.

## Persisting

The deploy is a real-world side effect, not validation state, so it lives in `deploy.json` on disk, not in the portable `state.json`. The only optional state touch is a best-effort cursor bump - `tl_state cursor` (or `tl cursor`) with `{ "phase": "deployed" }` - pure provenance; if it fails, the deploy still happened.
