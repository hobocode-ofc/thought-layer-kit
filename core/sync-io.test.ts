import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSync, hasGit } from "./sync-io.ts";
import { applyStateOp } from "./state-ops.ts";

// No spawn here: messages must never carry a banned dash (matches deploy.test.ts).
const hasBannedDash = (s: string): boolean =>
  s.includes("—") || s.includes("–") || s.includes(" - ") || s.includes(" -- ");

const ctx = () => ({ ts: Date.now(), exportedAt: new Date().toISOString() });
const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const collected: string[] = [];
async function run(opts: Parameters<typeof runSync>[0]) {
  const r = await runSync(opts, ctx());
  collected.push(r.message);
  return r;
}

describe("runSync guard paths (no network)", () => {
  it("init without a repo fails with a dash-free guide", async () => {
    const r = await run({ op: "init" });
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain("repo");
  });
  it("an unknown op fails", async () => {
    expect((await run({ op: "frobnicate" })).ok).toBe(false);
  });
  it("ops against a non-workspace dir fail cleanly", async () => {
    const empty = mkdtempSync(join(tmpdir(), "tl-nows-"));
    expect((await run({ op: "save", name: "x", dir: empty })).ok).toBe(false);
    expect((await run({ op: "list", dir: empty })).ok).toBe(false);
    expect((await run({ op: "status", dir: empty })).ok).toBe(false);
  });
  it("every collected message is dash-free", () => {
    for (const m of collected) expect(hasBannedDash(m), m).toBe(false);
  });
});

// A faithful, offline round-trip against a local bare repo (no GitHub). Gated on
// git being installed so the suite still passes in a git-less environment.
(hasGit() ? describe : describe.skip)("runSync round-trip (local bare repo)", () => {
  it("init, save, list, then two-clone pull reconciles to the union with no data loss", async () => {
    const root = mkdtempSync(join(tmpdir(), "tl-sync-"));
    const prevCfg = process.env["THOUGHT_LAYER_SYNC_CONFIG"];
    const prevState = process.env["THOUGHT_LAYER_STATE"];
    const prevDir = process.env["THOUGHT_LAYER_SESSIONS_DIR"];
    process.env["THOUGHT_LAYER_SYNC_CONFIG"] = join(root, "sync.json");
    delete process.env["THOUGHT_LAYER_STATE"];
    delete process.env["THOUGHT_LAYER_SESSIONS_DIR"];
    try {
      const origin = join(root, "origin.git");
      spawnSync("git", ["init", "--bare", "-q", origin]);
      const A = join(root, "A");
      const B = join(root, "B");
      const PB = join(".thought-layer", "photobooth.json");

      const init = await run({ op: "init", repo: origin, dir: A });
      expect(init.ok).toBe(true);
      expect(existsSync(join(A, ".gitattributes"))).toBe(true);
      expect(readFileSync(join(A, ".gitattributes"), "utf8")).toContain("-merge");
      expect(existsSync(join(A, ".gitignore"))).toBe(true);

      expect((await run({ op: "save", name: "photobooth", dir: A })).ok).toBe(true);
      applyStateOp({ op: "answer", qId: "what-statement", value: "photobooth for events", path: join(A, PB) }, ctx());
      expect((await run({ op: "save", name: "photobooth", dir: A })).ok).toBe(true);

      const list = await run({ op: "list", dir: A });
      expect(list.ok).toBe(true);
      expect(list.message).toContain("photobooth");

      // Second collaborator clones and adds a different answer, pushes.
      spawnSync("git", ["clone", "-q", origin, B]);
      applyStateOp({ op: "answer", qId: "target-market", value: "wedding venues", path: join(B, PB) }, ctx());
      git(B, ["add", "-A"]);
      git(B, ["commit", "-qm", "B target-market"]);
      git(B, ["push", "-q"]);

      // A diverges without pulling, then pulls: kit reconciles to the union.
      applyStateOp({ op: "answer", qId: "paid-today", value: "spreadsheets", path: join(A, PB) }, ctx());
      git(A, ["add", "-A"]);
      git(A, ["commit", "-qm", "A paid-today"]);
      const pull = await run({ op: "pull", dir: A });
      expect(pull.ok).toBe(true);
      expect(pull.details["merged"]).toBe(true);

      const merged = JSON.parse(readFileSync(join(A, PB), "utf8")); // must be valid JSON
      expect(Object.keys(merged.state.answers).sort()).toEqual(["paid-today", "target-market", "what-statement"]);

      // build.json (a built-product artifact) must stay ignored, never synced.
      writeFileSync(join(A, ".thought-layer", "build.json"), "{}");
      const porcelain = git(A, ["status", "--porcelain"]).stdout || "";
      expect(porcelain).not.toContain("build.json");

      for (const m of collected) expect(hasBannedDash(m), m).toBe(false);
    } finally {
      if (prevCfg === undefined) delete process.env["THOUGHT_LAYER_SYNC_CONFIG"]; else process.env["THOUGHT_LAYER_SYNC_CONFIG"] = prevCfg;
      if (prevState !== undefined) process.env["THOUGHT_LAYER_STATE"] = prevState;
      if (prevDir !== undefined) process.env["THOUGHT_LAYER_SESSIONS_DIR"] = prevDir;
    }
  });
});
