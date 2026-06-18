---
name: thought-layer-speedrun
description: "Run the Thought Layer at speed: a condensed five-stage validation spine (what it is, will anyone pay, market, price, do the numbers work) with fast unranked feedback - no panel, no score, no 0.85 gate, you move on when ready - then an optional brand pass and the PRD plus grill, so you still reach a build-ready spec. For the impatient and for demos. It trades the panel's defensible conviction for speed; run the full thought-layer-framework on anything you will actually build."
---

# The Thought Layer speedrun

The fast path to a build-ready spec. You still reach the same SHAPE of output the full framework produces - a PRD hardened by the grill - but the validation in front of it is compressed to five fast, unranked stages, and there is far less conviction behind it. No panel, no confidence score, no 0.85 gate: one honest read per stage, and you move on whenever you want.

For the impatient, and a good way to see the whole arc - validation to spec - in one sitting (a demo). It trades the panel's defensible conviction for speed: the spec is real and buildable, but the validation behind it is a gut-check, not an adversarial panel. For anything you will actually build, run the full **thought-layer-framework** (`/tl`) - the rigor is the part that was ever scarce. Speedrun is the taste and the on-ramp.

## How the fast feedback works

For each of the five stages, give ONE honest read - not three personas, no `tl_score`, no grade, no gate:

- The single strongest thing about the answer, and the single weakest.
- At most one sharp question or fix that would most improve it.
- Then ask: "sharpen it, or move on?" The user decides, every time. Keep offering feedback as they revise; never force a bar, never auto-advance.

Stay honest and stay fast: a few sentences, not an audit. **Fast does not mean kind** - a fatal flaw gets named plainly even if everything else gets one sentence. Park concerns that belong to the design phase in a line ("we'll catch that in the grill") rather than raising them now.

**This no-panel, no-score, no-gate, user-driven rule holds for the ENTIRE speedrun - the brand pass, the PRD, and the grill included.** Every sub-skill you invoke below runs in this unranked, user-driven mode: ignore its panel, `tl_score`, 0.85-gate, disqualifier-loop, and "categories covered" stop machinery, and let the user's "move on" end each step. The one exception is the grill's **metric-honesty rule**, kept below - it is cheap and load-bearing.

## The five-stage spine

One stage per turn, in order, waiting for the user between stages. Record each answer to the shared state file as you go (op `answer`; see "Persisting"). The question ids match the web app exactly, so a speedrun loads straight into it. The spine deliberately skips the framework's domain-knowledge, time, costs, scale, acquisition, relationships, and support stages; those stay blank by design, so a loaded file that reads as partially complete is expected, not an error. If a skipped stage holds something that genuinely blocks the spec, raise it in one line instead of re-opening the stage.

1. **The What** (`what-statement`) - "One sentence: a thing that does what, for whom." Clear and specific, not the pitch.
2. **Will anyone pay?** (`paid-today`, `evidence`) - "Has anyone paid you to solve this, or what is the strongest signal they will?" Liking is not buying.
3. **The market** (`target-market`, `incumbent-gap`) - "Who specifically is this for, and why won't an incumbent just copy it?" Start with the smallest market you can dominate.
4. **The price** (`pricing-model`) - "What is the number, and can you defend it in one sentence without apologizing?"
5. **Do the numbers move?** (`bm-who-buys`, `bm-who-supplies`) - "Name the price, a plausible customer count, and the main monthly costs as real numbers: does revenue clear cost, and roughly when?" The honest read is whether those are real estimates or hopeful blanks. Use the `tl_project` tool for a quick projection and store it as the `bizModel` artifact if useful. (`bm-parties` is intentionally left for the full mode, so the `/tl` upgrade stays lossless.)

After stage 5, before the design phase, branch on brand.

## Before the PRD: ask about brand

Ask the user once: **"Want to name it and sketch a quick brand before we spec it?"**

- If yes, run the **thought-layer-brand** skill (which wraps **thought-layer-naming** + the `tl_domains` tool) - for its stages and questions only: suppress its panel, `tl_score`, 0.85 gate, and disqualifier loop; one fast unranked read per brand step, and the user moves on when they like a direction. A speedrun brand is a directional sketch off an unvalidated idea - re-test it under `/tl` before you print it on anything. Its output feeds the PRD's identity and UX notes and persists as the `naming` and `brand` artifacts.
- If no, go straight to the PRD.

## The end - do NOT skip this, it is the whole point

The speedrun gets you all the way to a real spec, fast. The two design steps are not optional.

6. **The PRD.** Run the **thought-layer-prd** skill to compose the draft from the five answers (and the brand, if you ran it). Store it as the `prd` artifact.
7. **The grill.** Run the **thought-layer-grill** skill to harden it, speedrun-style. **In speedrun mode the user's "good enough, ship it" ends the grill, not category coverage - this overrides the grill skill's own stop rule.** Hit only the highest-risk gaps and contradictions; do not pursue completeness. Keep the grill's **metric-honesty rule** (the cheap backstop against vanity metrics); relax only the exhaustive-coverage stop and the gate. Update the PRD inline and re-store the `prd` artifact when done.

What you get is a fast first draft built on a gut-check, not a validated spec. Re-running the grill under `/tl`, with the panels behind it, is what turns it into something to bet on.

## Persisting

Write to the state file as you go, like the full framework (see the **thought-layer-framework** skill's "Saving and resuming"): answers via op `answer`, the bizModel / naming / brand / prd / grill via op `artifact`, and a cursor via op `cursor` after each stage so the file resumes and upgrades cleanly (use the backbone stage numbers - the spine maps to stages 1, 3, 4, 9, 10, then the PRD is 14 and the grill 15; set `phase` to `speedrun`). The default file is `.thought-layer/state.json`; to keep several ideas apart, pass `--path .thought-layer/<name>.json` (or the tool's `path`) on every op, or set `THOUGHT_LAYER_STATE`, and use `list` to see what is already there. **Do not write graded feedback** - the speedrun does not rank, so there are no panel verdicts to store and the answers persist ungraded.

This keeps a speedrun loadable in the web app and upgradable. If you resume a file that already has panel feedback or a `/tl` cursor, do not discard it: tell the user which stages are already graded and only speedrun the still-open ones. If the user stops mid-spine, the answers so far are already saved - tell them the file location and that they can resume here or upgrade to `/tl` anytime.

## Demo mode

If the user just wants to see how this works, offer to run the whole thing on a sample idea (suggest one, for example a scheduling tool for mobile dog groomers) so they can watch the arc - five fast reads, an optional brand, a PRD, a quick grill - in a couple of minutes. It is still one stage per turn, pausing for the user: demo mode is fast, not unattended. The sample writes a real `state.json`, so clear it (or run it in a throwaway directory) before the user starts on their own idea.
