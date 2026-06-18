---
name: thought-layer-framework
description: "Walk a founder through the full Thought Layer validation framework in order, one stage at a time, evaluating each stage with the panel at that stage's altitude, and only reaching design (the PRD draft, then the grill) at the end. Use this to run the whole rigor on an idea. It is the backbone; the panel, grill, prd, and naming skills are the stages it orchestrates."
---

# The Thought Layer framework

Compression theory: AI made building cheap, so value moved to the layer it did not compress, which is knowing what to build and being able to defend it. This framework walks that layer in stages. Each stage has its own altitude. Validate the idea first, make the economic model real second, and design and build last. Do not jump ahead: the worst failure mode is auditing implementation details on a one-sentence idea.

## How to run it

**Start by asking for the idea.** Do not expect it handed to you at invocation. If the user has not given it yet, open with the first stage's question ("What is this? One sentence: a thing that does what, for whom") and wait for their answer. If they paste a fuller description, treat it as their answer to stage 1 (the Concise What) and evaluate that — but do not let a rich paragraph tempt you to skip ahead. A detailed idea still owes you every later stage.

Then walk the stages below **in order, one stage per turn**. For each stage:

1. Ask the stage's question. If the user already addressed it in earlier input, draft their answer back to them in a line and ask them to confirm or sharpen it rather than re-asking from scratch. If they are stuck, offer the example as a model answer, not as the truth.
2. Evaluate their answer with the **thought-layer-panel** skill, at this stage's altitude, and use the `tl_score` tool for the verdict.
3. The stage is done when aggregate confidence reaches 0.85, or when the user says to set it aside (carry the unresolved suggestions forward as to-dos).
4. Advance **exactly one** stage, ask that stage's question, and **stop for the user's answer.** Never batch stages, never answer them on the user's behalf, and never skip from an early stage to the design phase. Keep prior answers as context for coherence, but never lower an early stage's grade for a concern that belongs to a later stage. Park such concerns for the stage that owns them.

Reaching the Grill or the PRD before all of Part 1 (validate the idea) and Part 2 (the business model) are worked through is the signature failure of this framework. Do not do it. The Grill and the PRD are the design phase and they come last.

## Saving and resuming (this runs across many sessions)

No one finishes this in one sitting. The work lives in a portable file, `.thought-layer/state.json`, in the project directory. It is your memory across turns and sessions, and it is the SAME interop file the web app reads, so a founder can answer some stages here and hand the file to a co-founder who continues in the web app (weareallproductmanagersnow.com, "Load progress from file"), back and forth, losslessly. Never hand-write this JSON: use the tool below, which builds the exact shapes the web app expects.

**The tool.** If the `tl_state` tool is available (Pi), use it. Otherwise run the CLI from any shell: `npx -y @hobocode/thought-layer tl <op> ...` (or just `tl ...` if the package is installed). Ops: `read`, `list`, `answer`, `feedback`, `artifact`, `cursor`, `park`, `export`.

**Choosing the file.** The default is `.thought-layer/state.json`. To keep several ideas side by side, give each its own file and use the SAME path for every op in the session: pass `--path .thought-layer/<name>.json` (or the tool's `path`), or set `THOUGHT_LAYER_STATE` once as the session default. `list` shows the files already there.

**On start, ALWAYS read first.** `tl_state read` (or `tl read`). If a file exists, summarize where the run stands and **resume from the saved cursor** - do not restart at stage 1. If not, start fresh; the file is created on first write. If `list` shows more than one state file, ask which idea to resume (or to start a new one) before reading, and stick to that path for the rest of the session.

**After each stage:**
1. Record the answer against its question id: `tl_state` op `answer` (or `tl answer <qId> "<value>"`).
2. Record the panel verdict: `tl_state` op `feedback` - pass it the per-persona assessments + confidences and the end state (`pass` when confidence clears 0.85, `setAside` when the user sets it aside with to-dos, else `open`). The tool computes the status, grade, and to-dos; you supply only prose + numbers.
3. Save the cursor: `tl_state` op `cursor` with the backbone stage number and phase, so the next session resumes exactly here.

**Stage to question id** (use these exact ids; the tool rejects unknown ones):

| Stage | id(s) |
|---|---|
| 1 Concise What | `what-statement` |
| 2 Domain Knowledge | `domain-experience`, `domain-gaps` |
| 3 Validation | `paid-today`, `evidence` |
| 4 Market Selection | `target-market`, `incumbent-gap` |
| 5 30-Second Test | `pitch` |
| 6 Time | `commitment` |
| 7 Costs | `cost-architecture`, `cost-risk` |
| 8 Scale | `realistic-goal` |
| 9 Pricing | `pricing-model` |
| 10 Business Model | `bm-who-buys`, `bm-who-supplies`, `bm-parties` (+ `bizModel` artifact) |
| 11 Customer Acquisition | `first-ten`, `retention` |
| 12 Customer Relationships | `crm-approach`, `crm-community` |
| 13 Support | `support-model`, `support-scaling` |
| 14 PRD | `prd-problem`, `prd-not-building` (+ `prd` artifact) |
| 15 Grill | `grill` artifact (re-compose `prd` markdown on done) |

**Artifacts** (PRD, grill, bizModel, naming, brand, swot, research) go through op `artifact`, which normalizes them to the web app's shapes. **Web-app-only fields** - the Decision Support questions (`dq-*`), the press-release fields, and the launch-asset fields - have no stage here; leave them for the founder in the web app, do not write them. **Module sub-stage verdicts** that have no web-app question (the deep-dive modules' internal stages) go to op `park`, never into answers.

**At session end or handoff,** run `export` to confirm the file is current, and tell the founder where it is and that they (or a collaborator) can load it into the web app or keep going with the agent.

## Sync and collaborate (optional: a private GitHub repo as the home for sessions)

For founders juggling several ideas, or collaborating with others, the session files can live in the user's OWN private GitHub repo instead of just locally. The `tl_sync` tool (Pi) or `tl sync` (any shell) manages it, BYOK with no central account:
- `tl sync init --repo <owner/name>` sets a private repo as a sessions workspace (one repo for the user's own projects, a separate repo per outside founder they help, so each stays isolated).
- `tl sync save --name <name>` snapshots the current state as a named session (photobooth, peptide, blogging), commits, and pushes. `tl sync list` lists them; `tl sync open --name <name>` pulls and resumes one (it prints the `THOUGHT_LAYER_STATE` line to point the rest of the session at that file).
- Collaboration is granted on GitHub: the user adds collaborators to the repo themselves; the kit never changes permissions. When two people edit the same session, the kit reconciles the two copies itself (newest wins per field, any coarse tie-break is reported), so git never has to merge the JSON by hand.

This is optional. The local default (`.thought-layer/state.json`) and the web-app handoff above work exactly as before without it.

## Part 1: Validate the idea

Altitude: is the idea clear, honest, real, and worth pursuing? Not how it will be built.

1. **The Concise What.** "What is this? One sentence: a thing that does what, for whom." Done when: one clear, specific sentence names the thing, what it does, and who it is for. Not the pitch, not the value prop, not the architecture.
2. **Domain Knowledge.** "What is your direct experience in this space, and what do you NOT know?" Done when: real experience is described, plus three to five honestly named blind spots, each with how it will be closed (research, advisor, partner).
3. **Validation.** "Have you solved this manually for someone who paid you? What evidence that people will pay for a product version?" Done when: concrete evidence of willingness to pay (paid work, a pilot, letters of intent, deposits, repeated inbound). Liking is not buying.
4. **Market Selection.** "Who specifically are you selling to and why that segment? Why won't an incumbent just copy this?" Done when: a specific, reachable segment with a reason, and a credible reason a big company will not bother. Start with the smallest market you can dominate.
5. **The 30-Second Test.** "Explain the value in thirty seconds: what it is, who it is for, why it matters." Done when: a tight, jargon-free pitch a stranger would understand. Clarity beats complexity.

## Part 2: Make the model real (the business model)

Altitude: does the economic machine work? This is where unit economics, CAC, money flow, and operational logistics belong, the concerns the early panels parked.

6. **Time.** "How much time can you commit, what will you sacrifice, and when do you expect results?" Done when: honest hours and an honest timeline.
7. **Costs.** "What will it cost to build and run this (infrastructure, AI and tools, your time)? What if your core model's price doubles?" Done when: ballpark monthly figures with stated assumptions, and a plan if a core capability depends on a model you do not control.
8. **Scale Expectations.** "What does realistic success look like in 12 months and in 3 years?" Done when: concrete numbers consistent with the rest of the answers. A sustainable business is not a failure.
9. **Pricing.** "How will you price this, what is the number, and can you defend it in one sentence without apologizing?" Done when: a clear model and number with a one-sentence defense rooted in value, not cost-plus.
10. **Business Model.** "Who buys, who supplies, every party and the money flow between them, and do the numbers work?" Done when: each party is named with what they pay or get paid and what they cost to acquire, and a numeric model holds together. Use the `tl_project` tool for the projection (break-even, year-1 revenue, drawdown) rather than estimating.
11. **Customer Acquisition.** "How will you get your first 10 paying customers (not leads), and how will you keep them?" Done when: a concrete channel plan for the first 10 and a retention and sales-cycle picture.
12. **Customer Relationships.** "How will you track and nurture each relationship from first contact to renewal? Does community play a role?" Done when: a lifecycle, what you track, a tool you will actually keep up, and an honest in or out call on community.
13. **Support.** "When something breaks, what happens, and how does support scale without bankrupting you?" Done when: named channels, who answers, target response times, and a self-serve, automation, or outsourcing plan with triggers.

## Part 3: Design it (only now)

This is where "how will it actually be built" gets answered. Every implementation, UX, data, and edge-case concern parked during validation gets resolved here. Draft the spec first, then grill it.

14. **The PRD (draft).** Run the **thought-layer-prd** skill: compose a complete first-draft PRD — including a first-cut domain glossary and testable requirements — from the validated idea and the business model above.
15. **The Grill.** Run the **thought-layer-grill** skill: grill that draft PRD. Challenge it against the domain one question at a time, sharpen the glossary, surface contradictions, unstated rules, and edge cases, and update the PRD inline until it is build-ready.

Once the grill has hardened the PRD, the spec is build-ready. Run the **thought-layer-build** skill (`/tl-build`) to turn it into a static-first, deploy-ready artifact (or the `tl_scaffold` tool for an instant deployable landing-page floor). This is the build step, not another validation stage.

## Supporting passes (run when relevant)

Not strictly sequential; pull them in when they help: market research on the segment, a SWOT once the picture is full, and **thought-layer-naming** plus domain checks when the thing needs a name. These inform the stages above; they do not replace them.
