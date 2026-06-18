---
name: thought-layer-build
description: "Turn the hardened PRD into a static-first, deploy-ready artifact, built directly by this agent. Reads the build brief from the shared state file (PRD, glossary, R-ID requirements, brand, business context, open to-dos), then builds a self-contained site or a Vite/static build that yields a predictable publish directory (dist/), honoring ubiquitous language, R-ID traceability, the out-of-scope list, mobile+desktop, brand, and the full SEO/discoverability layer. When the spec genuinely requires a server, it also emits a real backend (serverless functions under netlify/functions/, a schema.sql, a names-only .env.example, an updated netlify.toml, and a BACKEND.md guide) and records it in the manifest, while staying honest that backend deploy automation is a follow-up so the default deploy path stays static. Verifies the build runs and writes a .thought-layer/build.json manifest for the deploy step. Run it after the grill has hardened the PRD; it is a standalone build step, not a validation stage."
---

# Build it: the hardened PRD becomes a deploy-ready artifact

You are not generating a prompt to paste elsewhere. **You are the agent that builds.** The hardened PRD is your brief; build it now, static-first, and verify it actually runs. AI made building cheap, so the value is building the *right* thing, honestly, and shipping something real and ownable. One pass, then verify. This is a build step, not a second framework: no panel, no stages, no per-turn loop.

For the fastest possible deployable thing, or as a floor when a full build is too much, you can run the **tl_scaffold** tool first (or instead) - it deterministically writes a branded, SEO-complete static landing site you can ship immediately, then build the real product on top.

## Precondition: a hardened PRD must exist

Read the state file first (next section). Then:
- **Required:** `state.prd` with a non-empty `markdown` and a non-empty `requirements` array.
- **Ideal:** `state.grill.done === true` (the PRD was actually hardened). If `prd` exists but the grill is absent or not done, build anyway and warn in one line: "Building from a drafted-but-not-grilled PRD - gaps the grill would have caught may surface; `/tl-grill` first would tighten it."
- **Refuse** only when there is no `prd.markdown` / no requirements at all: say so and point to `/tl` (the full framework) or at least `/tl-prd` then `/tl-grill`. Proceed cold only if the user explicitly says to, and record in DECISIONS.md that the spec was incomplete.

## Read the brief from the state file

The spec lives in `.thought-layer/state.json` (or a named file). Honor the same selection as the rest of the kit: an explicit `--path` / tool `path` wins, then `THOUGHT_LAYER_STATE`, then the default. If the `tl_state` tool is available (Pi), `tl_state read`; otherwise `tl read --json` (the CLI). If neither a path nor the env is set, `tl list` (or `tl_state list`) first and **ask which idea to build** when several exist, then stick to that path for the whole session and write `build.json` next to it.

Assemble the brief from the state:
- `prd.markdown` - the full spec (your primary source of truth).
- `prd.glossary` `[{term, definition}]` - the ubiquitous language to enforce.
- `grill.requirements` if `grill.done`, else `prd.requirements` `[{id, category, text}]` - the R-IDs to build and trace.
- `prd.weakestAssumptions` - flag these as known gaps in DECISIONS.md.
- `brand` - the identity to apply (skip if absent; see ground rules).
- `bizModel.assumptions` / key `answers` - a one-line business context.
- `feedback` to-dos and any "Open validation to-dos" in the PRD - known gaps the founder set aside; build around them, do not treat them as blockers.

## The ground rules (honor these exactly)

- **Ubiquitous language.** Use the glossary's terms verbatim for every entity, field, route, and UI label. Do not introduce synonyms.
- **Traceability.** Every requirement has an R-ID. Create `TRACEABILITY.md` mapping each R-ID to the file/component that implements it and how it is verified (a test, a manual check, or "deferred").
- **Out of scope is absolute.** Do not build past the spec's Out-of-Scope list, even if it looks easy.
- **Mobile and desktop both work.** Responsive by default; check both viewports.
- **Brand.** If `state.brand` is present, apply its colors, type, voice, and name throughout. If absent, pick a clean, neutral, accessible default and record the choice in DECISIONS.md.
- **Ask nothing, decide and record.** The spec is the answer; where it is genuinely silent, choose the simplest option consistent with the PRD and record it in `DECISIONS.md` rather than blocking.

## Build static-first

Default to a self-contained static site or a Vite/Astro/static build whose output is one publish directory (`dist/`); set the manifest `hasBackend: false`. Pure HTML/CSS/JS where the interactivity allows; a bundler only when the spec warrants it.

**Escalate to a backend ONLY if a requirement genuinely needs one** - apply this three-question test to the R-IDs:
1. Does it need a **secret** that cannot ship to the browser (a server-side API key, a payment secret)?
2. Does it need **shared or persistent state across users** (a real database, server-stored accounts)?
3. Does it need **trusted server-side enforcement** (something the client must not be allowed to fake)?

If all three are no, build **static, full stop.** localStorage, static data files, BYOK client-side AI calls, and third-party embeddable widgets do **not** count as a backend - many specs that sound like they need a server can ship a compelling static slice first.

**When a backend is genuinely required, build it for real (do not just warn).** Build the static front end as above, set `hasBackend: true` and a one-line `backendNote`, and emit a coherent, buildable serverless backend alongside it:

- **Serverless functions, one per backend R-ID**, under `netlify/functions/`. Name each file in the ubiquitous language (the glossary term for what it does, e.g. `netlify/functions/dispatch.ts`), open it with a comment naming the R-ID it implements, and keep it inside the out-of-scope boundary. Each function reads its inputs, talks to the database, and returns JSON. Give the front end a clear seam: it calls the function at `fetch('/.netlify/functions/<name>')`, never a hardcoded host.
- **A `schema.sql`** at the project root, derived from the PRD data requirements and the domain entities. Name tables and columns in the glossary terms (no synonyms), and keep it idempotent where you can (`create table if not exists ...`).
- **Neon Postgres by default.** The functions reach the database through the Neon serverless driver (`@neondatabase/serverless`, added to the product's `package.json`, never the kit's) and read the connection string from `DATABASE_URL` (Netlify sets `NETLIFY_DATABASE_URL` when you provision managed Neon, so read `DATABASE_URL` and map it). Neon is the single documented default and is overridable to any Postgres by pointing `DATABASE_URL` elsewhere; state that in `BACKEND.md` and do not invent a second provider.
- **A names-only `.env.example`** at the project root listing every variable the backend reads (`DATABASE_URL` plus any others), each as a bare `NAME=` under a one-line comment. Never write a real value; real values live only in the host environment.
- **An updated `netlify.toml`.** Extend the existing publish + redirect block (do not replace it) with a `[functions]` table declaring `directory = "netlify/functions"`. Keep the static publish dir and the SPA redirect intact.
- **A `BACKEND.md` deploy guide** at the project root: what is in the repo, the honest status (automated backend deploy is a follow-up, so `tl deploy` ships only the front end today), how to provision Neon, the env-var table, the function-to-R-ID table, and the manual `netlify deploy` steps. The kit's `renderBackendGuide` and `renderEnvExample` helpers (in `core/backend.ts`) produce a dash-free skeleton if you have the core available; otherwise write the same content by hand.
- **A project `.gitignore`** that ignores `.env` and `.env.*` but un-ignores the contract with `!.env.example`. Without that line the env contract is silently un-committable, and the deploy follow-up cannot read it.

Then record the backend in the manifest's `backend` block (shape below). Do **not** attempt to deploy the backend in this step: `tl deploy` publishes the static front end, and backend deploy automation is the explicit follow-up. Say so plainly in chat and point the user at `BACKEND.md`.

## SEO and discoverability (build all of it, do not skip it)

This is the cheap moat. Either run **tl_scaffold** to lay these down for you, or build them by hand into the publish dir, and set each `build.json.seo.*` flag from the file you actually emitted:
- schema.org JSON-LD as one `@graph` (Organization + Person(founder) cross-referenced, WebSite, and the page type that matches the content); never a type that does not match visible content.
- `/llms.txt` (title, one-paragraph summary, links to the key pages, a short FAQ).
- `sitemap.xml`, `robots.txt` (allow search + AI crawlers, point to the sitemap), a canonical link, Open Graph + Twitter meta, and a 1200x630 social image.
- Semantic, accessible HTML: landmarks, ordered headings, alt text, labelled controls, a visible focus style.
- A `netlify.toml` (publish dir + SPA redirect) and a `SEO.md` documenting where each item lives and what to fill later (the sameAs links, the social image, the real domain).

## Verify before you call it done

Do not declare victory - check:
1. **Run the build.** For a bundler: `npm install` then the build command; confirm it exits clean (capture the command into `build.json.buildCommand`). For pure static: confirm the files exist.
2. **Confirm the publish dir + entry load.** `dist/index.html` (or your entry) exists and is non-trivial. Where a preview or browser tool is available, load it and confirm it renders; otherwise inspect the built HTML for the expected title/nav/hero and that the mobile viewport meta is set.
3. **R-ID coverage.** Walk TRACEABILITY.md: each R-ID is implemented (with a pointer) or explicitly deferred (with a reason). Put the counts in `build.json.requirements`.
4. **SEO check.** Confirm the SEO files are actually in the publish dir; set `build.json.seo.*` from reality, not intent.
5. **Backend check (only when `hasBackend`).** Each backend R-ID maps to a function in TRACEABILITY.md; `netlify/functions/` has one file per backend R-ID; `.env.example` is values-free (every variable line is a bare `NAME=`, never a value); `schema.sql` is non-empty; `netlify.toml` declares the functions directory; `.gitignore` has `!.env.example`. Do **not** try to run the backend or reach a database here (there is no `DATABASE_URL` in the build env); confirm the artifact is coherent and buildable, not live.
6. **Report** what is built and what is deferred, plainly, in chat.

## Honest about being model-built

If you cannot fully build it (the spec is thin, a requirement you genuinely cannot satisfy, time or tool limits), ship **the best static slice that loads** plus DECISIONS.md noting every gap and TRACEABILITY.md marking the unbuilt R-IDs deferred. A partial, honest, deployable artifact beats a complete-looking broken one. **Never fake a green check** - `verified.buildRan: false` is an acceptable, honest value. If even a slice is too much, run **tl_scaffold** to leave a real deployable landing page as the floor.

## Leave a manifest and your decisions

Write three files with your own file tools (the manifest is NOT a `tl_state` artifact - it is a plain sidecar):
- `.thought-layer/build.json` - the deploy contract, co-located with the state file you read. Shape (fill what you can, never fake a field):

```jsonc
{ "app": "thought-layer", "kind": "build", "version": 1, "builtAt": "<ISO>",
  "producer": "agent", "publishDir": "dist", "entry": "index.html",
  "stack": "static|vite|astro|next-static|other", "hasBackend": false, "backendNote": null,
  "backend": null,
  "buildCommand": null, "installCommand": null, "nodeVersion": "20",
  "provenance": { "stateFile": "<the file you read>", "prdTs": <state.prd.ts>, "grillDone": <bool>, "fromSpeedrun": <bool> },
  "requirements": { "total": 0, "built": 0, "deferred": 0, "deferredIds": [] },
  "seo": { "jsonLd": true, "llmsTxt": true, "sitemap": true, "robots": true, "canonical": true, "openGraph": true, "socialImage": false, "semanticHtml": true, "seoDoc": true, "netlifyToml": true },
  "artifacts": { "traceability": "TRACEABILITY.md", "decisions": "DECISIONS.md", "seo": "SEO.md" },
  "verified": { "buildRan": true, "publishDirExists": true, "entryLoads": true, "notes": "..." } }
```
  `publishDir` + `entry` are load-bearing - the deploy step reads them. (The `tl_scaffold` tool writes this same manifest with `producer: "scaffold"`.)

  When `hasBackend` is `true`, populate `backend` (leave it `null` for a static build). This is the forward-looking contract the backend deploy automation will consume:

```jsonc
"backend": {
  "backendKind": "serverless", "functionsDir": "netlify/functions",
  "runtime": "nodejs20.x", "nodeVersion": "20",
  "envVars": [{ "name": "DATABASE_URL", "required": true, "description": "Neon Postgres connection string" }],
  "database": { "provider": "neon", "schemaFile": "schema.sql", "envVar": "DATABASE_URL" },
  "guide": "BACKEND.md" }
```
- `DECISIONS.md` - every choice the spec did not pin down, one line each, with the reason.
- `TRACEABILITY.md` - the R-ID map. (`SEO.md` comes from the SEO step.)

## Persisting

The build output and the three files live on disk; the portable `state.json` stays focused on validation and design. The only optional state touch is a best-effort cursor bump - `tl_state cursor` (or `tl cursor`) with `{ "backboneStage": 15, "phase": "built" }` - pure provenance; if the tool is absent or it fails, the build still succeeded. Tell the user where the artifact is (`<publishDir>`) and that the next step is the deploy - the **thought-layer-deploy** skill (`/tl-deploy`) or the `deploy` tool / `tl deploy` CLI, which reads `build.json` and takes it live to a URL they own.
