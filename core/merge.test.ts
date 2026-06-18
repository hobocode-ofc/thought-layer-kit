import { describe, it, expect } from "vitest";
import { mergeProgressStates } from "./merge.ts";
import { emptyState, buildProgress, serializeProgress, parseProgress, type ProgressState } from "./progress.ts";

const base = (over: Partial<ProgressState>): ProgressState => ({ ...emptyState(), ...over });

describe("mergeProgressStates: answers", () => {
  it("unions non-overlapping answers from both sides", () => {
    const ours = base({ answers: { a: "1" } });
    const theirs = base({ answers: { b: "2" } });
    const { state, coarse } = mergeProgressStates(ours, theirs, { oursTs: 1, theirsTs: 2 });
    expect(state.answers).toEqual({ a: "1", b: "2" });
    expect(coarse).toEqual([]);
  });

  it("keeps an identical answer with no coarse flag", () => {
    const { coarse } = mergeProgressStates(base({ answers: { a: "x" } }), base({ answers: { a: "x" } }), { oursTs: 1, theirsTs: 2 });
    expect(coarse).toEqual([]);
  });

  it("tie-breaks a conflicting answer to the newer file and reports it", () => {
    const ours = base({ answers: { a: "mine" } });
    const theirs = base({ answers: { a: "theirs" } });
    expect(mergeProgressStates(ours, theirs, { oursTs: 9, theirsTs: 1 }).state.answers["a"]).toBe("mine"); // ours newer
    const r = mergeProgressStates(ours, theirs, { oursTs: 1, theirsTs: 9 });
    expect(r.state.answers["a"]).toBe("theirs"); // theirs newer
    expect(r.coarse).toContain("answers.a");
  });

  it("on an exact timestamp tie, the incoming side (theirs) wins, deterministically", () => {
    const r = mergeProgressStates(base({ answers: { a: "mine" } }), base({ answers: { a: "theirs" } }), { oursTs: 5, theirsTs: 5 });
    expect(r.state.answers["a"]).toBe("theirs");
    expect(r.coarse).toContain("answers.a");
  });
});

describe("mergeProgressStates: feedback", () => {
  it("resolves a feedback collision by higher round", () => {
    const ours = base({ feedback: { a: { round: 1, ts: 100, status: "yellow" } } });
    const theirs = base({ feedback: { a: { round: 2, ts: 1, status: "green" } } });
    const r = mergeProgressStates(ours, theirs, { oursTs: 9, theirsTs: 1 }); // ours newer file, but theirs has higher round
    expect((r.state.feedback["a"] as Record<string, unknown>)["status"]).toBe("green");
    expect(r.coarse).toContain("feedback.a");
  });

  it("unions non-overlapping feedback", () => {
    const r = mergeProgressStates(base({ feedback: { a: { round: 1 } } }), base({ feedback: { b: { round: 1 } } }), { oursTs: 1, theirsTs: 2 });
    expect(Object.keys(r.state.feedback).sort()).toEqual(["a", "b"]);
  });
});

describe("mergeProgressStates: artifacts", () => {
  it("non-null beats null without a coarse flag", () => {
    const ours = base({ prd: { markdown: "spec" } });
    const theirs = base({ prd: null });
    const r = mergeProgressStates(ours, theirs, { oursTs: 1, theirsTs: 9 });
    expect(r.state.prd).toEqual({ markdown: "spec" });
    expect(r.coarse).toEqual([]);
  });

  it("two differing artifacts pick the newer generatedAt and report the key", () => {
    const ours = base({ research: { generatedAt: 100, note: "old" } });
    const theirs = base({ research: { generatedAt: 200, note: "new" } });
    const r = mergeProgressStates(ours, theirs, { oursTs: 9, theirsTs: 1 }); // file ts ignored when generatedAt differs
    expect((r.state.research as Record<string, unknown>)["note"]).toBe("new");
    expect(r.coarse).toContain("research");
  });

  it("falls back to file ts when artifacts have no generatedAt", () => {
    const r = mergeProgressStates(base({ grill: { v: 1 } }), base({ grill: { v: 2 } }), { oursTs: 9, theirsTs: 1 });
    expect((r.state.grill as Record<string, unknown>)["v"]).toBe(1); // ours newer
    expect(r.coarse).toContain("grill");
  });
});

describe("mergeProgressStates: kit namespace", () => {
  it("unions modulesRun + parked, takes max updatedAt, cursor from the newer file", () => {
    const ours = base({ kit: { schema: 1, updatedAt: 100, modulesRun: ["a"], parked: { q1: ["n1"] }, cursor: { phase: "x" } } });
    const theirs = base({ kit: { schema: 1, updatedAt: 200, modulesRun: ["b"], parked: { q1: ["n2"], q2: ["n3"] }, cursor: { phase: "y" } } });
    const r = mergeProgressStates(ours, theirs, { oursTs: 1, theirsTs: 2 }); // theirs newer file
    const kit = r.state.kit!;
    expect(kit.updatedAt).toBe(200);
    expect(kit.modulesRun!.sort()).toEqual(["a", "b"]);
    expect(kit.parked!["q1"]!.sort()).toEqual(["n1", "n2"]);
    expect(kit.parked!["q2"]).toEqual(["n3"]);
    expect(kit.cursor).toEqual({ phase: "y" }); // newer file
  });

  it("keeps the one present kit when only one side has it", () => {
    const ours = base({ kit: { schema: 1, updatedAt: 50, modulesRun: ["only"] } });
    const r = mergeProgressStates(ours, base({}), { oursTs: 1, theirsTs: 2 });
    expect(r.state.kit!.modulesRun).toEqual(["only"]);
  });
});

describe("mergeProgressStates: unknown keys + round-trip", () => {
  it("carries unknown future keys through, newer side wins", () => {
    const ours = base({ futureThing: { v: "old" } } as Partial<ProgressState>);
    const theirs = base({ futureThing: { v: "new" } } as Partial<ProgressState>);
    expect((mergeProgressStates(ours, theirs, { oursTs: 1, theirsTs: 9 }).state as Record<string, unknown>)["futureThing"]).toEqual({ v: "new" });
    expect((mergeProgressStates(ours, theirs, { oursTs: 9, theirsTs: 1 }).state as Record<string, unknown>)["futureThing"]).toEqual({ v: "old" });
  });

  it("produces a state that round-trips losslessly through the envelope", () => {
    const ours = base({ answers: { a: "1" }, prd: { markdown: "spec" }, kit: { schema: 1, updatedAt: 5 } });
    const theirs = base({ answers: { b: "2" }, naming: { generatedAt: 9, names: ["X"] } });
    const { state } = mergeProgressStates(ours, theirs, { oursTs: 1, theirsTs: 2 });
    const round = parseProgress(serializeProgress(buildProgress(state, { kind: "kit", ts: 1 }, "2026-06-18T00:00:00Z"))).state;
    expect(round.answers).toEqual({ a: "1", b: "2" });
    expect(round.prd).toEqual({ markdown: "spec" });
    expect(round.naming).toEqual({ generatedAt: 9, names: ["X"] });
  });
});
