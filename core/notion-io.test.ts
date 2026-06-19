import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasGit } from "./sync-io.ts";
import { runWiki } from "./notion-io.ts";
import { applyStateOp } from "./state-ops.ts";

const ctx = () => ({ ts: Date.now(), exportedAt: new Date().toISOString() });

// The MCP path's contract: emit-plan builds the full plan from the session in a
// sessions repo with NO Notion token and NO network call. Gated on git so the
// suite still passes git-less.
(hasGit() ? describe : describe.skip)("runWiki emit-plan (MCP path: no token, no network)", () => {
  it("returns the agent-replayable plan with no token set", async () => {
    const A = mkdtempSync(join(tmpdir(), "tl-wiki-"));
    const prev = {
      sync: process.env["THOUGHT_LAYER_SYNC_CONFIG"],
      state: process.env["THOUGHT_LAYER_STATE"],
      dir: process.env["THOUGHT_LAYER_SESSIONS_DIR"],
      tok1: process.env["THOUGHT_LAYER_NOTION_TOKEN"],
      tok2: process.env["NOTION_TOKEN"],
    };
    process.env["THOUGHT_LAYER_SYNC_CONFIG"] = join(A, "sync.json");
    delete process.env["THOUGHT_LAYER_STATE"]; // else it overrides the session selection
    delete process.env["THOUGHT_LAYER_SESSIONS_DIR"];
    delete process.env["THOUGHT_LAYER_NOTION_TOKEN"];
    delete process.env["NOTION_TOKEN"];
    try {
      spawnSync("git", ["init", "-q", A]); // runWiki requires a git sessions repo
      // Populate a session (saveStateFile creates .thought-layer/ for us).
      applyStateOp(
        { op: "answer", qId: "what-statement", value: "A dispatch tool for HVAC crews.", path: join(A, ".thought-layer", "demo.json") },
        ctx(),
      );

      const r = await runWiki({ name: "demo", dir: A, emitPlan: true });
      expect(r.ok, r.message).toBe(true);
      const plan = r.details["plan"] as {
        title: string;
        icon: string;
        overview: string;
        areas: Array<{ key: string; title: string; emoji: string; markdown: string }>;
        artifacts: unknown[];
      };
      expect(plan).toBeTruthy();
      expect(plan.title).toContain("workspace");
      expect(plan.icon).toBe("🚀");
      const bigIdea = plan.areas.find((a) => a.key === "big-idea");
      expect(bigIdea, "big-idea area missing").toBeTruthy();
      expect(bigIdea!.markdown).toContain("A dispatch tool for HVAC crews.");
      // No artifacts delivered, so the list is empty but present.
      expect(Array.isArray(plan.artifacts)).toBe(true);
    } finally {
      for (const [k, v] of Object.entries({
        THOUGHT_LAYER_SYNC_CONFIG: prev.sync,
        THOUGHT_LAYER_STATE: prev.state,
        THOUGHT_LAYER_SESSIONS_DIR: prev.dir,
        THOUGHT_LAYER_NOTION_TOKEN: prev.tok1,
        NOTION_TOKEN: prev.tok2,
      })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
