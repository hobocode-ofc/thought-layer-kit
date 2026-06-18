import { describe, it, expect } from "vitest";
import {
  slugify, parseSyncConfig, serializeSyncConfig, emptySyncConfig, selectWorkspace,
  resolveCloneDir, defaultSessionsDir, parseGitStatus, type SyncConfig,
} from "./sync.ts";

describe("slugify", () => {
  it("slugs a human session name to a filename stem", () => {
    expect(slugify("Photo Booth!")).toBe("photo-booth");
    expect(slugify("Peptide v2")).toBe("peptide-v2");
    expect(slugify("  Blogging  ")).toBe("blogging");
    expect(slugify("a/b\\c:d")).toBe("a-b-c-d");
  });
  it("returns empty for an unnameable input so the caller can reject it", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("---")).toBe("");
    expect(slugify("!@#$")).toBe("");
  });
  it("caps length and trims a trailing hyphen", () => {
    const s = slugify("x".repeat(60));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("sync config", () => {
  const cfg: SyncConfig = {
    schema: 1, activeWorkspace: "personal",
    workspaces: [
      { name: "personal", repo: "me/sessions", defaultBranch: "main", cloneDir: "/home/me/.thought-layer/sessions" },
      { name: "acme", repo: "me/acme-sessions", defaultBranch: "main", cloneDir: "/home/me/.thought-layer/sessions-acme", activeSession: "photobooth.json" },
    ],
  };

  it("round-trips through serialize/parse", () => {
    expect(parseSyncConfig(serializeSyncConfig(cfg))).toEqual(cfg);
  });
  it("drops a workspace with no cloneDir and tolerates junk", () => {
    expect(parseSyncConfig("not json")).toEqual(emptySyncConfig());
    const c = parseSyncConfig(JSON.stringify({ workspaces: [{ name: "x" }, { cloneDir: "/d" }] }));
    expect(c.workspaces).toHaveLength(1);
    expect(c.workspaces[0]!.cloneDir).toBe("/d");
    expect(c.workspaces[0]!.defaultBranch).toBe("main"); // defaulted
  });

  it("selects a workspace by name, then active, then the only one", () => {
    expect(selectWorkspace(cfg, "acme")!.name).toBe("acme");
    expect(selectWorkspace(cfg)!.name).toBe("personal"); // active
    const one: SyncConfig = { schema: 1, workspaces: [cfg.workspaces[1]!] };
    expect(selectWorkspace(one)!.name).toBe("acme"); // the only one
    expect(selectWorkspace(emptySyncConfig())).toBeNull();
  });
});

describe("resolveCloneDir", () => {
  const home = "/home/me";
  it("honors precedence: explicit > env > workspace > default", () => {
    const ws = { name: "w", repo: "r", defaultBranch: "main", cloneDir: "/ws/dir" };
    expect(resolveCloneDir({ explicit: "/x", env: "/y", workspace: ws, home })).toBe("/x");
    expect(resolveCloneDir({ env: "/y", workspace: ws, home })).toBe("/y");
    expect(resolveCloneDir({ workspace: ws, home })).toBe("/ws/dir");
    expect(resolveCloneDir({ home })).toBe(defaultSessionsDir(home));
    expect(defaultSessionsDir(home)).toBe("/home/me/.thought-layer/sessions");
  });
});

describe("parseGitStatus", () => {
  it("reads branch, ahead/behind, and dirty files", () => {
    const out = ["## main...origin/main [ahead 1, behind 2]", " M .thought-layer/photobooth.json", "?? note.txt"].join("\n");
    const s = parseGitStatus(out);
    expect(s.branch).toBe("main");
    expect(s.ahead).toBe(1);
    expect(s.behind).toBe(2);
    expect(s.dirty).toBe(true);
    expect(s.files).toEqual([".thought-layer/photobooth.json", "note.txt"]);
  });
  it("reports a clean tree", () => {
    const s = parseGitStatus("## main...origin/main");
    expect(s.branch).toBe("main");
    expect(s.ahead).toBe(0);
    expect(s.dirty).toBe(false);
    expect(s.files).toEqual([]);
  });
});
