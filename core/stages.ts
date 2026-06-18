// The kit's mapping from framework backbone stages (and the optional modules)
// to the web app question ids they write into answers[]. Hand-maintained, but
// guarded: core/stages.test.ts fails if any mapped qId is missing from the
// vendored stage-map (regenerated from the web app). That is the drift
// protection for the two-repo interop contract - rename a qId in the web app,
// re-run sync-stage-map, and the test goes red until this map is updated.

import { ANSWERABLE_QIDS, ALL_QIDS } from "./stage-map.ts";

const ANSWERABLE_SET = new Set(ANSWERABLE_QIDS);
const ALL_SET = new Set(ALL_QIDS);

// A question id the agent may write a value into answers[] for.
export function isAnswerableQid(qId: string): boolean {
  return ANSWERABLE_SET.has(qId);
}
// A question id (answerable or artifact/page step) the web app knows about.
export function isKnownQid(qId: string): boolean {
  return ALL_SET.has(qId);
}

// Backbone stage (in framework order) -> the answer qIds it writes. Stages that
// only produce an artifact (PRD, grill, business-model numbers) are noted but
// have no answer ids beyond the prose questions listed here.
export const BACKBONE_QID_MAP: Record<string, readonly string[]> = {
  "concise-what": ["what-statement"],
  "domain-knowledge": ["domain-experience", "domain-gaps"],
  "validation": ["paid-today", "evidence"],
  "market-selection": ["target-market", "incumbent-gap"],
  "thirty-second-test": ["pitch"],
  "time": ["commitment"],
  "costs": ["cost-architecture", "cost-risk"],
  "scale": ["realistic-goal"],
  "pricing": ["pricing-model"],
  "business-model": ["bm-who-buys", "bm-who-supplies", "bm-parties"],
  "customer-acquisition": ["first-ten", "retention"],
  "customer-relationships": ["crm-approach", "crm-community"],
  "support": ["support-model", "support-scaling"],
  "prd": ["prd-problem", "prd-not-building"],
};

// Optional deep-dive modules -> the answer qIds they may write. The modules
// mostly converge into backbone qIds; these are the ids unique to a module.
export const MODULE_QID_MAP: Record<string, readonly string[]> = {
  "market-research": ["market-research"],
  "brand": ["brand-feel", "brand-unlike"],
  // strategy folds into market-selection (target-market / incumbent-gap) and
  // produces the swot artifact; business-model folds into costs/pricing and
  // produces the bizModel artifact - neither has a unique answer qId.
};

// Every answer qId the kit may write, across backbone + modules. The drift test
// asserts this is a subset of the web app's answerable registry.
export const KIT_WRITTEN_QIDS: readonly string[] = [
  ...new Set([
    ...Object.values(BACKBONE_QID_MAP).flat(),
    ...Object.values(MODULE_QID_MAP).flat(),
  ]),
];

// qIds the agent deliberately leaves for the founder in the web app (no kit
// stage). Surfaced so the framework skill can skip them explicitly rather than
// writing empty strings (which read as "attempted and blank").
export const WEB_APP_ONLY_QIDS: readonly string[] = [
  "headline", "customer-quote", "press-why-now", // press release
  "deck-audience", "landing-goal", // launch assets
  "dq-frame", "dq-alternatives", "dq-information", "dq-values", "dq-reasoning", "dq-commitment", // decision science
];
