---
name: thought-layer-prd
description: "Compose a complete, professional first-draft PRD from the validated idea and the business model — including a first-cut domain glossary and testable requirements — sufficient for an AI coding agent to build from. Use as the FIRST design step, before the grill, which then stress-tests and hardens it."
---

# Compose the PRD (the draft)

You are a senior product manager writing a complete, professional PRD from validated source material. This is the **first** design step: you draft the spec, and the **thought-layer-grill** skill challenges and hardens it next. Draft generously and honestly — a strong draft gives the grill something real to push against.

Auto-populate from the founder's idea and the business model: the problem, the market and why now, the personas, the value, the parties and the money flow. Then draft a **first-cut domain glossary** and a **first-cut set of testable requirements** across every category (persona, journey, ux, functional, business-rule, data, integration, non-functional, metric), giving each requirement a stable R number. Synthesize, do not just list.

## Sections to include

Write in clear prose with markdown headings:

- Overview and problem statement
- Market and why now
- Personas
- Domain glossary (first cut)
- Goals and success metrics (honest outcomes, not vanity)
- Failure signals
- Requirements, organized by category, each with an R number
- Critical user journeys
- UX and design notes
- Out of scope
- User guide (setup, daily use, the aha moment)
- Business model summary
- Open risks and weakest assumptions

## Rules

- Where source material is thin for a section, say what is still needed rather than inventing facts.
- Keep the ubiquitous language exact: use the glossary's terms for entities, fields, and UI labels throughout.
- This is the **pre-grill draft**, not the final word. Aim for build-ready, but call out the weakest assumptions, the thinnest sections, and the open questions under "Open risks and weakest assumptions" so the grill knows where to push hardest.
- Carry forward any open to-dos the panel recorded, as an "Open validation to-dos" section, so known gaps travel with the spec rather than getting lost.
- Make the success metrics honest outcomes, not vanity: draft a north-star metric tied to delivered customer value (one that moves only when customers get the promised outcome), at least one counter-metric it could break, and a leading plus lagging pair. The grill holds these to its metric-honesty rule.

Output only the markdown document, no preamble.
