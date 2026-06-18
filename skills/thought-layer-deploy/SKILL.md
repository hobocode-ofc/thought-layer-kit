---
name: thought-layer-deploy
description: "Take the built site live to a user-owned URL with no lock-in, the last step after the build. Reads .thought-layer/build.json (the publish dir + entry) next to the state file, then deploys to Netlify by one of two BYOK models: with NETLIFY_AUTH_TOKEN set it deploys into the user's OWN account via the file-digest API (owned immediately, no claim), and with no token it uses the Netlify CLI's own --allow-anonymous flow for an instant live URL plus a one-hour claim link. Static-first: if build.json says hasBackend it warns that only the front end ships this way. Prefers the deploy tool (Pi) or the tl deploy CLI (any shell agent) so the deploy is one mechanical, honest step, never hand-rolled. Run it after thought-layer-build (or tl_scaffold) has produced build.json."
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
- **Anonymous (when no token is set).** Delegates to the Netlify CLI's `netlify deploy --allow-anonymous` (Netlify's own supported flow) for an instant live URL plus a **one-hour claim link** that transfers ownership to whatever account the user logs into. We never reverse-engineer that handshake. It needs a current Netlify CLI (`npm i -g netlify-cli@latest`; the flag shipped 2026-03); if the CLI is missing or too old, the tool says exactly what to do (set a token, update the CLI, or drag the publish dir onto https://app.netlify.com/drop).

If neither a token nor a usable CLI is available, relay the tool's guidance honestly instead of pretending it deployed.

## Static-first honesty

The default deploy publishes a **static** publish directory. If `build.json.hasBackend` is `true`, the tool warns and you must repeat it plainly: only the front end goes live this way; the server part needs serverless functions or a separate host. Do not imply a backend is running when it is not.

## After it is live

Report, plainly:
- the **live URL**, and (anonymous only) the **claim link** with the one-hour window called out;
- for the token path, that it is already owned by their account and how to re-deploy (`--site <id>`);
- that a `.thought-layer/deploy.json` record was written (URL, mode, site/deploy ids) next to `build.json`.

If the tool returned `ok: false`, do not claim success - surface its message (the next honest step) verbatim.

## Persisting

The deploy is a real-world side effect, not validation state, so it lives in `deploy.json` on disk, not in the portable `state.json`. The only optional state touch is a best-effort cursor bump - `tl_state cursor` (or `tl cursor`) with `{ "phase": "deployed" }` - pure provenance; if it fails, the deploy still happened.
