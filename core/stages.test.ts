import { describe, it, expect } from "vitest";
import { ANSWERABLE_QIDS, ALL_QIDS } from "./stage-map.ts";
import {
  BACKBONE_QID_MAP, MODULE_QID_MAP, KIT_WRITTEN_QIDS, WEB_APP_ONLY_QIDS,
  isAnswerableQid, isKnownQid,
} from "./stages.ts";

const ANSWERABLE = new Set(ANSWERABLE_QIDS);
const ALL = new Set(ALL_QIDS);

// This is the DRIFT GUARD. If the web app renames or removes a question id and
// the stage map is re-synced, these go red until BACKBONE/MODULE maps catch up.
describe("stage map drift guard", () => {
  it("every backbone-mapped qId is a real answerable web-app question", () => {
    for (const [stage, qids] of Object.entries(BACKBONE_QID_MAP)) {
      for (const q of qids) {
        expect(ANSWERABLE.has(q), `backbone "${stage}" maps to missing/non-answerable qId "${q}"`).toBe(true);
      }
    }
  });

  it("every module-mapped qId is a real answerable web-app question", () => {
    for (const [mod, qids] of Object.entries(MODULE_QID_MAP)) {
      for (const q of qids) {
        expect(ANSWERABLE.has(q), `module "${mod}" maps to missing/non-answerable qId "${q}"`).toBe(true);
      }
    }
  });

  it("every web-app-only qId the agent skips is a real question id", () => {
    for (const q of WEB_APP_ONLY_QIDS) {
      expect(ALL.has(q), `web-app-only "${q}" is not a known qId`).toBe(true);
    }
  });

  it("kit-written and web-app-only sets do not overlap (clean division of labor)", () => {
    const written = new Set(KIT_WRITTEN_QIDS);
    for (const q of WEB_APP_ONLY_QIDS) {
      expect(written.has(q), `"${q}" is both kit-written and web-app-only`).toBe(false);
    }
  });
});

describe("qId helpers", () => {
  it("classifies answerable vs known vs unknown", () => {
    expect(isAnswerableQid("what-statement")).toBe(true);
    expect(isAnswerableQid("prd-grill")).toBe(false); // artifact step, not answerable
    expect(isKnownQid("prd-grill")).toBe(true);
    expect(isAnswerableQid("totally-made-up")).toBe(false);
    expect(isKnownQid("totally-made-up")).toBe(false);
  });
});
