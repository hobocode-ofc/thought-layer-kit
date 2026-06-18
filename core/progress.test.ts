import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROGRESS_FORMAT, parseProgress, buildProgress, serializeProgress, emptyState,
  buildFeedbackEntry, normalizeRequirements, setAnswer, setFeedbackEntry, setArtifact, setCursor, parkNote,
} from "./progress.ts";
import { loadStateFile, saveStateFile, listStateFiles, resolveStatePath, STATE_ENV } from "./state-file.ts";

const writer = { kind: "kit" as const, version: "test", ts: 123 };
const roundTrip = (state: Record<string, unknown>) =>
  parseProgress(serializeProgress(buildProgress(state, writer, "2026-06-17T00:00:00Z")));

describe("envelope round-trip", () => {
  it("writes the shared format with the kit writer stamp", () => {
    const p = buildProgress({ ...emptyState(), answers: { "what-statement": "x" } }, writer, "ts");
    expect(p.app).toBe("thought-layer");
    expect(p.format).toBe(PROGRESS_FORMAT);
    expect(p.format).toBe(2);
    expect(p.writer?.kind).toBe("kit");
  });

  it("preserves answers, naming, brand, kit, and unknown future keys", () => {
    const out = roundTrip({
      answers: { "what-statement": "a scheduling tool" },
      naming: { candidates: [{ name: "Acme" }], chosen: "Acme", model: "claude", generatedAt: 1 },
      brand: { guide: { brandName: "Acme" }, logos: [], chosenLogoId: null, model: "claude", generatedAt: 1 },
      kit: { schema: 1, cursor: { backboneStage: 3 }, updatedAt: 9 },
      decisionScience: { foo: "bar" }, // unknown future key
    });
    expect((out.state.answers as Record<string, string>)["what-statement"]).toBe("a scheduling tool");
    expect((out.state.naming as { chosen: string }).chosen).toBe("Acme");
    expect((out.state.brand as { guide: { brandName: string } }).guide.brandName).toBe("Acme");
    expect((out.state.kit as { cursor: { backboneStage: number } }).cursor.backboneStage).toBe(3);
    expect((out.state as Record<string, unknown>)["decisionScience"]).toEqual({ foo: "bar" });
  });

  it("defaults missing artifacts to null and rejects non-TL files", () => {
    const out = roundTrip({ answers: {} });
    for (const k of ["bizModel", "grill", "assets", "research", "swot", "prd", "naming", "brand", "kit"]) {
      expect(out.state[k]).toBe(null);
    }
    expect(() => parseProgress("{bad")).toThrow(/valid JSON/);
    expect(() => parseProgress(JSON.stringify({ app: "x", state: {} }))).toThrow(/Thought Layer/);
  });

  it("accepts (does not reject) a newer format and flags it", () => {
    const future = JSON.stringify({ app: "thought-layer", format: 99, state: { version: 2, answers: { "what-statement": "y" } } });
    const out = parseProgress(future);
    expect(out.formatNewer).toBe(true);
    expect((out.state.answers as Record<string, string>)["what-statement"]).toBe("y");
  });
});

describe("buildFeedbackEntry (the corruption guard)", () => {
  const panel = [
    { persona: "redteam", assessment: "TAM asserted", confidence: 0.82, confidenceRationale: "too generous", suggestions: [{ summary: "rebuild bottom-up", patch: "start from payroll SMBs" }] },
    { persona: "expert", assessment: "segment sound", confidence: 0.88, suggestions: [{ summary: "cite comparable" }] },
    { persona: "investor", assessment: "size clears the bar", confidence: 0.91, suggestions: [] },
  ];

  it("a genuine pass does NOT set overridden (so it never reads 'set aside by you')", () => {
    const fb = buildFeedbackEntry({ mode: "panel", personas: panel, endState: "pass", round: 2, ts: 1 });
    expect(fb.overridden).toBe(false);
    expect(fb.exited).toBe(false);
    expect(fb.stale).toBe(false);
    expect(fb.todos).toEqual([]);
    // mean of 0.82/0.88/0.91 = 0.87 -> green dot, and the web app computes done
    expect(fb.confidence).toBeCloseTo(0.87, 5);
    expect(fb.status).toBe("green");
    expect(fb.mode).toBe("panel");
    expect(fb.assessment).toBe(""); // panel mode has no single assessment
  });

  it("namespaces persona + suggestion ids and merges suggestions", () => {
    const fb = buildFeedbackEntry({ mode: "panel", personas: panel, ts: 1 });
    expect(Object.keys(fb.personas)).toEqual(["redteam", "expert", "investor"]);
    expect(fb.personas["redteam"]!.suggestions[0]!.id).toBe("redteam-s1");
    expect(fb.personas["redteam"]!.suggestions[0]!.persona).toBe("redteam");
    expect(fb.suggestions).toHaveLength(2); // redteam + expert; investor had none
  });

  it("set-aside forces green + freezes deduped to-dos", () => {
    const fb = buildFeedbackEntry({ mode: "panel", personas: panel, endState: "setAside", ts: 1 });
    expect(fb.overridden).toBe(true);
    expect(fb.exited).toBe(true);
    expect(fb.status).toBe("green");
    expect(fb.todos.map((t) => t.id)).toEqual(["redteam-s1", "expert-s1"]);
  });

  it("single-persona mode carries that persona's assessment", () => {
    const fb = buildFeedbackEntry({ mode: "expert", personas: [{ persona: "expert", assessment: "looks fine", confidence: 0.7 }], ts: 1 });
    expect(fb.mode).toBe("expert");
    expect(fb.assessment).toBe("looks fine");
    expect(fb.confidence).toBe(0.7);
    expect(fb.status).toBe("yellow");
  });

  it("clamps garbled confidence to a neutral 0.6", () => {
    const fb = buildFeedbackEntry({ mode: "expert", personas: [{ persona: "expert", confidence: NaN as unknown as number }], ts: 1 });
    expect(fb.personas["expert"]!.confidence).toBe(0.6);
  });
});

describe("requirement remap", () => {
  it("maps the kit's statement field to the web app's text field", () => {
    const out = normalizeRequirements([{ id: "r1", category: "functional", statement: "must X" }, { category: "data", text: "stores Y" }]);
    expect(out[0]).toEqual({ id: "r1", category: "functional", text: "must X" });
    expect(out[1]).toEqual({ id: "r2", category: "data", text: "stores Y" });
  });
});

describe("mutators", () => {
  it("setAnswer accepts an answerable qId and bumps the kit clock", () => {
    const s = setAnswer(emptyState(), "what-statement", "a tool", 555);
    expect((s.answers as Record<string, string>)["what-statement"]).toBe("a tool");
    expect(s.kit?.updatedAt).toBe(555);
  });

  it("setAnswer rejects artifact-step and unknown qIds (but allows real answer questions)", () => {
    // prd-grill is an artifact/page step - it stores nothing under answers[]
    expect(() => setAnswer(emptyState(), "prd-grill", "x", 1)).toThrow(/not an answerable/);
    expect(() => setAnswer(emptyState(), "made-up-id", "x", 1)).toThrow(/not an answerable/);
    // dq-frame IS answerable (a real text question); it is web-app-only by skill
    // policy, not a core invariant, so the data layer permits it.
    expect(() => setAnswer(emptyState(), "dq-frame", "x", 1)).not.toThrow();
  });

  it("setArtifact, setCursor, parkNote update the kit namespace", () => {
    let s = setArtifact(emptyState(), "prd", { markdown: "# PRD" }, 10);
    expect((s.prd as { markdown: string }).markdown).toBe("# PRD");
    s = setCursor(s, { backboneStage: 14, phase: "prd" }, 20);
    expect(s.kit?.cursor?.backboneStage).toBe(14);
    expect(s.kit?.updatedAt).toBe(20);
    s = parkNote(s, "brand.voice", "tone is generic", 30);
    expect(s.kit?.parked?.["brand.voice"]).toEqual(["tone is generic"]);
  });
});

describe("state file IO", () => {
  it("a missing file loads as empty; save then load round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "tl-state-"));
    const first = loadStateFile(undefined, dir);
    expect(first.exists).toBe(false);
    expect(first.state.answers).toEqual({});

    const s = setAnswer(first.state, "what-statement", "a scheduling tool", 1);
    saveStateFile(s, { cwd: dir, ts: 1, exportedAt: "2026-06-17T00:00:00Z" });

    const reloaded = loadStateFile(undefined, dir);
    expect(reloaded.exists).toBe(true);
    expect((reloaded.state.answers as Record<string, string>)["what-statement"]).toBe("a scheduling tool");
    expect(reloaded.path).toBe(join(dir, ".thought-layer", "state.json"));
  });
});

describe("named files, env default, and list", () => {
  it("an explicit target wins; the env var is the session fallback; else the default", () => {
    const prev = process.env[STATE_ENV];
    try {
      delete process.env[STATE_ENV];
      expect(resolveStatePath(undefined, "/proj")).toBe(join("/proj", ".thought-layer", "state.json"));
      process.env[STATE_ENV] = "/tmp/x/custom.json";
      expect(resolveStatePath(undefined, "/proj")).toBe("/tmp/x/custom.json");
      // an explicit path still overrides the env default
      expect(resolveStatePath(".thought-layer/acme.json", "/proj")).toBe(join("/proj", ".thought-layer", "acme.json"));
    } finally {
      if (prev === undefined) delete process.env[STATE_ENV];
      else process.env[STATE_ENV] = prev;
    }
  });

  it("keeps several ideas as separate files and lists them", () => {
    const dir = mkdtempSync(join(tmpdir(), "tl-multi-"));
    const stamp = { ts: 1, exportedAt: "2026-06-17T00:00:00Z" };
    saveStateFile(setAnswer(emptyState(), "what-statement", "idea A", 1), { target: join(dir, ".thought-layer", "acme.json"), ...stamp });
    saveStateFile(setAnswer(emptyState(), "what-statement", "idea B", 1), { target: join(dir, ".thought-layer", "bravo.json"), ...stamp });

    expect(listStateFiles(dir).map((f) => f.name)).toEqual(["acme.json", "bravo.json"]);
    // the files are independent
    expect((loadStateFile(join(dir, ".thought-layer", "acme.json")).state.answers as Record<string, string>)["what-statement"]).toBe("idea A");
    expect((loadStateFile(join(dir, ".thought-layer", "bravo.json")).state.answers as Record<string, string>)["what-statement"]).toBe("idea B");
  });
});
