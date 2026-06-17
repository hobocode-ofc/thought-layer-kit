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

## Supporting passes (run when relevant)

Not strictly sequential; pull them in when they help: market research on the segment, a SWOT once the picture is full, and **thought-layer-naming** plus domain checks when the thing needs a name. These inform the stages above; they do not replace them.
