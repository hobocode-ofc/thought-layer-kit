# The Thought Layer Kit

Rigor for building. AI made building cheap. It did not make **knowing what to build** cheap, and it did not make a confident, defensible plan cheap. This kit puts that rigor inside the agent you already use, then carries it toward a live thing you own.

The loop it is building toward:

> **validate the idea, grill it into a buildable spec, build it, deploy it.** One agent. Your own key. Nothing phones home.

This is open source and BYOK by design. The point is to help people build real things instead of confident slop, not to sell you a platform.

## What is here

**The rigor, as portable [Agent Skills](https://www.anthropic.com/news/skills)** (work in any agent that reads the format):

- **thought-layer-panel.** Pressure-test an idea or any answer with an adversarial panel (red team, domain expert, skeptical investor). Get a confidence score, a letter grade, and at most three material fixes, looping until it is genuinely good enough or you set it aside.
- **thought-layer-grill.** A domain-driven discovery interview that turns a validated idea into a domain glossary plus testable requirements.
- **thought-layer-prd.** Compose a complete, buildable PRD from everything above.
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

Run the whole flow with `/tl`, or one stage at a time:

1. `/tl-panel` until the idea clears the bar (aggregate confidence 0.85 or higher) or you decide it is good enough. The panel uses `tl_score` to compute the verdict.
2. `/tl-grill` to turn it into requirements and a glossary.
3. `/tl-prd` to compose the buildable spec.
4. `/tl-naming` whenever you need a name. It uses `tl_domains` to check availability.

To check domains live, set a RapidAPI key in your environment (`THOUGHT_LAYER_DOMAIN_KEY` or `RAPIDAPI_KEY`). With no key, the naming step links out to a domain search instead of calling out.

The hosted version of the rigor lives at [weareallproductmanagersnow.com](https://weareallproductmanagersnow.com) if you would rather not install anything.

## Roadmap

- **Done:** the rigor as portable skills, and a Pi package with deterministic tools + slash commands.
- **Phase 3:** a `build` step that turns the PRD into a deploy-ready artifact, built by your own agent.
- **Phase 4:** a `deploy` step that publishes it to a live URL you own (Netlify deploy-and-claim by default), closing the loop.

## Notes for contributors

- The deterministic engine in `core/` is TypeScript, with `vitest` tests (`npm test`) and a strict `tsc --noEmit` typecheck. It is the single source of truth for scoring, domain checks, and the projection model.
- This is a TypeScript-source package: relative imports carry `.ts` extensions so Pi's loader and Vite resolve them directly. It is meant to be consumed by TS-aware tooling, not a plain Node `require`.

## License

MIT. Copyright Hobocode LLC.
