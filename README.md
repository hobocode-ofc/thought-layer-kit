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

**A Pi package** that adds, on top of the skills:

- **Deterministic tools** the agent can call so the math is exact and never re-derived: `tl_score` (confidence to status and grade), `tl_domains` (availability, BYOK), `tl_project` (the numeric business projection).
- **Slash commands** (prompt templates): `/tl` runs the whole flow, and `/tl-panel`, `/tl-grill`, `/tl-prd`, `/tl-naming` run each stage.

## Install

### Pi

```bash
pi install npm:@hobocode/thought-layer
# or, before it is published:
pi install git:github.com/hobocode-ofc/thought-layer-kit
```

Installing the package lights up the skills, the `/tl` commands, and the `tl_score` / `tl_domains` / `tl_project` tools. You can also invoke a skill directly with `/skill:thought-layer-panel`.

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

- **Done:** the rigor as portable skills, and a Pi package with deterministic tools + slash commands.
- **Phase 3:** a `build` step that turns the PRD into a deploy-ready artifact, built by your own agent.
- **Phase 4:** a `deploy` step that publishes it to a live URL you own (Netlify deploy-and-claim by default), closing the loop.

## Notes for contributors

- The deterministic engine in `core/` is TypeScript, with `vitest` tests (`npm test`) and a strict `tsc --noEmit` typecheck. It is the single source of truth for scoring, domain checks, and the projection model.
- This is a TypeScript-source package: relative imports carry `.ts` extensions so Pi's loader and Vite resolve them directly. It is meant to be consumed by TS-aware tooling, not a plain Node `require`.
- **Iterating on skills in Pi:** `pi update` syncs files to disk but a running Pi session keeps the skill registry it built at startup — it does not hot-reload. After adding or editing a skill or prompt, **restart Pi** (or run `/reload` if your build supports it) to pick up the change. Symptom of a stale session: a newly added skill is missing from the picker, or a skill shows an outdated description.

## Acknowledgments

The Grill skill's interview technique — relentless, one question at a time, sharpening the domain glossary as it goes — is inspired by Matt Pocock's [`grill-with-docs`](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md) (MIT, © Matt Pocock). His grills an architecture plan against existing domain docs; this kit adapts the technique to grill a draft PRD against the domain, hardening its glossary and requirements inline.

## License

MIT. Copyright Hobocode LLC.
