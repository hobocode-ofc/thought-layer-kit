# The Thought Layer Kit

Rigor for building. AI made building cheap. It did not make **knowing what to build** cheap, and it did not make a confident, defensible plan cheap. This kit puts that rigor inside the agent you already use, then carries it toward a live thing you own.

The loop it is building toward:

> **validate the idea, grill it into a buildable spec, build it, deploy it.** One agent. Your own key. Nothing phones home.

This is open source and BYOK by design. The point is to help people build real things instead of confident slop, not to sell you a platform.

## What is here

**The rigor, as portable [Agent Skills](https://www.anthropic.com/news/skills)** (work in any agent that reads the format):

- **thought-layer-framework.** The backbone. Walks a founder through the full staged framework in order: validate the idea (what it is, domain knowledge, validation, market selection, the pitch), make the business model real (time, costs, scale, pricing, the model, acquisition, relationships, support), then design (PRD draft, then grill) last. It evaluates each stage at its own altitude, so a one-line idea is never audited for implementation details.
- **thought-layer-panel.** Pressure-test the answer to one stage with an adversarial panel (red team, domain expert, skeptical investor), at that stage's altitude. Confidence score, letter grade, at most three stage-appropriate fixes; later-stage concerns get parked, not penalized.
- **thought-layer-prd.** Draft the complete PRD — with a first-cut domain glossary and testable requirements — from the validated idea and business model. The plan the grill then hardens.
- **thought-layer-grill.** The last design step: grills the draft PRD against the domain one question at a time, sharpening the glossary and hardening the requirements inline until it is build-ready. Runs after the PRD, not instead of the framework.
- **thought-layer-naming.** Name the thing, with rationale and domain-ready slugs.
- **thought-layer-build.** Build the hardened PRD into a static-first, deploy-ready artifact, verified to run, and leave a manifest the deploy step reads. When a requirement genuinely needs a server, it also emits a real backend (serverless functions, a `schema.sql`, a names-only `.env.example`, and a `BACKEND.md` guide), with Neon Postgres as the documented default.
- **thought-layer-deploy.** Take the build live to a URL you own, with no lock-in: a Netlify token deploys into your own account, or the Netlify CLI handles a logged-in or anonymous deploy.
- **thought-layer-wiki.** Auto-generate a private Notion wiki, an internal intranet that organizes everything the workflow built (the thinking, the brand and styles, the business model, the PRD, the deploy rules) and links every artifact you delivered to GitHub. Private to your own Notion workspace, BYOK token, no public exposure.
- **thought-layer-compliance.** Once the business is defined, research its governance, regulatory, compliance, licensing, and taxation-prep needs for your exact jurisdiction and entity type, and hand back a cited report (live links, costs, renewal cycles, filing deadlines, a critical path to launch) to review with your own legal and tax advisors. Research and a starting checklist, not legal or tax advice; it saves as the governance artifact, so it rides along into the GitHub bundle and the Notion wiki.
- **thought-layer-speedrun.** A fast, unranked path to a build-ready spec when you do not need the full panel and score.
- **Optional deep-dives**, pulled in when you want to go further than the backbone: `thought-layer-strategy`, `thought-layer-brand`, `thought-layer-market-research`, and `thought-layer-business-model`.

**A Pi package** that adds, on top of the skills:

- **Deterministic tools** the agent can call so the math is exact and never re-derived: `tl_score` (confidence to status and grade), `tl_domains` (availability, BYOK), `tl_project` (the numeric business projection), `tl_state` (the portable progress file), `tl_scaffold` (a deterministic, deployable static site from the spec + brand), `deploy` (take the build live to a URL you own), `tl_sync` (store and sync your sessions in your own private GitHub repo), `tl_artifacts` (deliver the full asset bundle to that repo), and `tl_wiki` (build a private Notion wiki from the session and those artifacts).
- **Slash commands** (prompt templates): `/tl` runs the whole flow; `/tl-speedrun` is the fast unranked path; `/tl-panel`, `/tl-grill`, `/tl-prd`, `/tl-naming` run each stage; `/tl-build` builds the hardened PRD into a deploy-ready artifact; `/tl-deploy` takes it live; `/tl-artifacts` delivers the full asset bundle to your repo; `/tl-wiki` builds a private Notion intranet from it; `/tl-compliance` researches your GRC, licensing, and tax readiness.
- **A `tl` CLI** for any shell agent (`npx -y @hobocode/thought-layer tl ...`): `read`/`list`/`answer`/`feedback`/`artifact`/`cursor`/`export` for the shared progress file, `scaffold` for the deployable static-site floor, `deploy` to take the build live, and `sync` to store and version your sessions in your own private GitHub repo.

## Install

### Pi

```bash
pi install npm:@hobocode/thought-layer
# or track the latest from GitHub:
pi install git:github.com/hobocode-ofc/thought-layer-kit
```

Installing the package lights up the skills, the `/tl` commands, and the deterministic tools (`tl_score`, `tl_domains`, `tl_project`, `tl_state`, `tl_scaffold`, `deploy`). You can also invoke a skill directly with `/skill:thought-layer-panel`.

### Claude Code (or any agent that reads the Agent Skills format)

Copy each skill folder into `~/.claude/skills/`:

```bash
cp -r skills/* ~/.claude/skills/
```

The skills work as-is; the Pi-specific tools and slash commands are Pi only. Other agents adopt the `SKILL.md` format with minor adaptation.

## How to use it

Run the whole framework with `/tl`. It walks the stages in order and does not skip ahead:

1. **Validate the idea:** what it is, your domain knowledge, validation (will anyone pay), market selection, the 30-second pitch. The panel judges each at the idea's altitude. It will not pressure-test how the thing is built yet.
2. **Make the model real:** time, costs, scale, pricing, the business model and its numbers (via `tl_project`), acquisition, relationships, support. This is where unit economics and operational logistics get scrutinized.
3. **Design it (last):** `/tl-prd` drafts the PRD (with a first-cut glossary and requirements); `/tl-grill` then grills that draft against the domain until it is build-ready. Every "how will it actually work" concern parked during validation gets resolved here.

Each stage clears at confidence 0.85 or when you set it aside (open items carry forward as to-dos). You can also run a single stage directly: `/tl-panel`, `/tl-grill`, `/tl-prd`, `/tl-naming`.

To check domains live, set a RapidAPI key in your environment (`THOUGHT_LAYER_DOMAIN_KEY` or `RAPIDAPI_KEY`). With no key, naming links out to a domain search instead of calling out.

The hosted version of the rigor lives at [weareallproductmanagersnow.com](https://weareallproductmanagersnow.com) if you would rather not install anything.

## Roadmap

- **Done:** the rigor as portable skills; a Pi package with deterministic tools + slash commands; the portable progress file (`tl_state` / the `tl` CLI) shared with the web app; and the speedrun.
- **Phase 3 (done):** a `build` step that turns the hardened PRD into a deploy-ready artifact, built by your own agent (`/tl-build`), with a deterministic `tl_scaffold` tool that writes an instantly-deployable branded static site as the floor.
- **Phase 4 (done):** a `deploy` step (`/tl-deploy`, the `deploy` tool, or `tl deploy`) that takes the build live to a URL you own, closing the loop. With a Netlify token it deploys into your own account via the file-digest API (owned immediately, no claim step); with no token it delegates to your Netlify CLI - logged in it creates a site in your account, logged out it deploys anonymously with a one-hour claim link. BYOK, no central account, no lock-in. `--dry-run` shows the plan first.
- **Backend-capable build (done):** when the three-question backend test shows a product genuinely needs a server, `/tl-build` emits a real backend alongside the static front end (serverless functions per backend requirement, a `schema.sql`, a names-only `.env.example`, an updated `netlify.toml`, and a `BACKEND.md` guide), with Neon Postgres as the documented default and overridable to any Postgres. Static stays the default, gated by the same backend test.
- **Backend deploy (done):** when `build.json` declares a backend, `/tl-deploy` (the `deploy` tool, or `tl deploy`) ships it automatically alongside the front end: the functions go up via your Netlify CLI and the declared env var names are set on the site (values read only from your environment, BYOK). `DATABASE_URL` is bring-your-own by default; `--provision-db` (your own Neon key) and `--apply-schema` (psql) are opt in, and `--static-only` ships just the front end. Owned, no lock-in.
- **Artifacts and wiki (done):** `tl artifacts` (the `tl_artifacts` tool) delivers the full asset bundle for a session, the PRD, brand guide + look book + logo, SWOT and business-model infographics, market research, a landing page, and any build/deploy provenance, to your own private sessions repo under `artifacts/<session>/`. `tl wiki` (the `tl_wiki` tool) then builds a **private Notion wiki**, an internal intranet that organizes all of it into a page per workflow area plus an Artifacts database that links each file. Notion pages are private to your own workspace (auth, not public); the integration token is BYOK from the environment. Free for one user, upgradeable for a team.
- **Sessions and collaboration (done):** `tl sync` (and the `tl_sync` tool) stores your session files in your OWN private GitHub repo. Save any number of named sessions (one private repo for your own projects, a separate repo per founder you collaborate with), list and open them, and sync. Git carries history and multi-user; the kit reconciles concurrent edits itself (newest wins per field, conflicts reported), so it never hand-merges JSON. Collaboration is granted on GitHub (you add collaborators, the kit never changes permissions). BYOK, no central account.

## Notes for contributors

- The deterministic engine in `core/` is TypeScript, with `vitest` tests (`npm test`) and a strict `tsc --noEmit` typecheck. It is the single source of truth for scoring, domain checks, and the projection model.
- This is a TypeScript-source package: relative imports carry `.ts` extensions so Pi's loader and Vite resolve them directly. It is meant to be consumed by TS-aware tooling, not a plain Node `require`.
- **Iterating on skills in Pi:** `pi update` syncs files to disk but a running Pi session keeps the skill registry it built at startup — it does not hot-reload. After adding or editing a skill or prompt, **restart Pi** (or run `/reload` if your build supports it) to pick up the change. Symptom of a stale session: a newly added skill is missing from the picker, or a skill shows an outdated description.

## Acknowledgments

The Grill skill's interview technique — relentless, one question at a time, sharpening the domain glossary as it goes — is inspired by Matt Pocock's [`grill-with-docs`](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md) (MIT, © Matt Pocock). His grills an architecture plan against existing domain docs; this kit adapts the technique to grill a draft PRD against the domain, hardening its glossary and requirements inline.

## License

MIT. Copyright Hobocode LLC.
