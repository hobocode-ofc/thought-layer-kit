---
name: thought-layer-build
description: "Turn the hardened PRD into a static-first, deploy-ready artifact, built directly by this agent. Reads the build brief from the shared state file (PRD, glossary, R-ID requirements, brand, business context, open to-dos), then builds a self-contained site or a Vite/static build that yields a predictable publish directory (dist/), honoring ubiquitous language, R-ID traceability, the out-of-scope list, mobile+desktop, brand, and the full SEO/discoverability layer. Escalates to a backend only when the spec genuinely requires server-side, and flags loudly that the default deploy path is static. Verifies the build runs and writes a .thought-layer/build.json manifest for the deploy step. Run it after the grill has hardened the PRD; it is a standalone build step, not a validation stage."
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

**When a backend is genuinely required:** build the static parts anyway, set `hasBackend: true` + `backendNote` in the manifest, and **warn loudly** in chat: the default deploy publishes a static `dist/` to Netlify, so the server part will not deploy that way and needs serverless functions or a separate host. Build the static shell with a clear seam for the backend.

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
5. **Report** what is built and what is deferred, plainly, in chat.

## Honest about being model-built

If you cannot fully build it (the spec is thin, a requirement you genuinely cannot satisfy, time or tool limits), ship **the best static slice that loads** plus DECISIONS.md noting every gap and TRACEABILITY.md marking the unbuilt R-IDs deferred. A partial, honest, deployable artifact beats a complete-looking broken one. **Never fake a green check** - `verified.buildRan: false` is an acceptable, honest value. If even a slice is too much, run **tl_scaffold** to leave a real deployable landing page as the floor.

## Leave a manifest and your decisions

Write three files with your own file tools (the manifest is NOT a `tl_state` artifact - it is a plain sidecar):
- `.thought-layer/build.json` - the deploy contract, co-located with the state file you read. Shape (fill what you can, never fake a field):

```jsonc
{ "app": "thought-layer", "kind": "build", "version": 1, "builtAt": "<ISO>",
  "producer": "agent", "publishDir": "dist", "entry": "index.html",
  "stack": "static|vite|astro|next-static|other", "hasBackend": false, "backendNote": null,
  "buildCommand": null, "installCommand": null, "nodeVersion": "20",
  "provenance": { "stateFile": "<the file you read>", "prdTs": <state.prd.ts>, "grillDone": <bool>, "fromSpeedrun": <bool> },
  "requirements": { "total": 0, "built": 0, "deferred": 0, "deferredIds": [] },
  "seo": { "jsonLd": true, "llmsTxt": true, "sitemap": true, "robots": true, "canonical": true, "openGraph": true, "socialImage": false, "semanticHtml": true, "seoDoc": true, "netlifyToml": true },
  "artifacts": { "traceability": "TRACEABILITY.md", "decisions": "DECISIONS.md", "seo": "SEO.md" },
  "verified": { "buildRan": true, "publishDirExists": true, "entryLoads": true, "notes": "..." } }
```
  `publishDir` + `entry` are load-bearing - the deploy step reads them. (The `tl_scaffold` tool writes this same manifest with `producer: "scaffold"`.)
- `DECISIONS.md` - every choice the spec did not pin down, one line each, with the reason.
- `TRACEABILITY.md` - the R-ID map. (`SEO.md` comes from the SEO step.)

## Persisting

The build output and the three files live on disk; the portable `state.json` stays focused on validation and design. The only optional state touch is a best-effort cursor bump - `tl_state cursor` (or `tl cursor`) with `{ "backboneStage": 15, "phase": "built" }` - pure provenance; if the tool is absent or it fails, the build still succeeded. Tell the user where the artifact is (`<publishDir>`) and that the next step is the deploy - the **thought-layer-deploy** skill (`/tl-deploy`) or the `deploy` tool / `tl deploy` CLI, which reads `build.json` and takes it live to a URL they own.
