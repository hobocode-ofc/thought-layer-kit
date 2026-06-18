import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha1Hex, buildFileDigests, normalizeKey, uploadPath, sanitizeSiteName,
  parseAnonymousOutput, deployRecord,
} from "./deploy.ts";
import { runDeploy } from "./deploy-io.ts";

describe("sha1Hex", () => {
  it("matches the known SHA1 of an empty string and 'abc'", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
});

describe("buildFileDigests", () => {
  it("keys by leading-slash path and dedupes uploads by content sha1", () => {
    const a = Buffer.from("hello");
    const { digests, pathForDigest } = buildFileDigests({ "/index.html": a, "copy.html": Buffer.from("hello"), "/other.txt": Buffer.from("world") });
    expect(digests["/index.html"]).toBe(sha1Hex("hello"));
    expect(digests["/copy.html"]).toBe(sha1Hex("hello")); // normalized to leading slash
    expect(digests["/other.txt"]).toBe(sha1Hex("world"));
    // one upload path per unique sha1 (the two "hello" files collapse to one).
    expect(Object.keys(pathForDigest)).toHaveLength(2);
    expect(pathForDigest[sha1Hex("hello")]).toBe("/index.html"); // first wins
  });
});

describe("normalizeKey / uploadPath", () => {
  it("normalizes to a leading-slash posix key", () => {
    expect(normalizeKey("index.html")).toBe("/index.html");
    expect(normalizeKey("/index.html")).toBe("/index.html");
    expect(normalizeKey("assets\\app.js")).toBe("/assets/app.js");
    expect(normalizeKey("./robots.txt")).toBe("/robots.txt");
  });
  it("strips the leading slash and encodes each segment for the upload URL", () => {
    expect(uploadPath("/index.html")).toBe("index.html");
    expect(uploadPath("/assets/app.js")).toBe("assets/app.js");
    expect(uploadPath("/a b/c+d.txt")).toBe("a%20b/c%2Bd.txt"); // segments encoded, slash kept
  });
});

describe("sanitizeSiteName", () => {
  it("produces a Netlify-safe [a-z0-9-] slug", () => {
    expect(sanitizeSiteName("Acme Dispatch!")).toBe("acme-dispatch");
    expect(sanitizeSiteName("  --Hello World--  ")).toBe("hello-world");
    expect(sanitizeSiteName("")).toBe("");
  });
});

describe("parseAnonymousOutput", () => {
  it("extracts the live URL and the claim link from CLI output", () => {
    const out = [
      "Deploying to draft URL...",
      "Website URL: https://wonderful-cupcake-123abc.netlify.app",
      "To claim this site, visit: https://app.netlify.com/claim?#eyJhbGciOi.token.sig",
    ].join("\n");
    const { url, claimUrl } = parseAnonymousOutput(out);
    expect(url).toBe("https://wonderful-cupcake-123abc.netlify.app");
    expect(claimUrl).toBe("https://app.netlify.com/claim?#eyJhbGciOi.token.sig");
  });
  it("returns nulls when neither is present", () => {
    expect(parseAnonymousOutput("nothing useful here")).toEqual({ url: null, claimUrl: null });
  });
});

describe("deployRecord", () => {
  it("stamps the constant app/kind/version/provider fields", () => {
    const rec = deployRecord({
      deployedAt: "2026-06-17T00:00:00.000Z", mode: "dry-run", publishDir: "dist", fileCount: 3,
      url: null, adminUrl: null, claimUrl: null, siteId: null, deployId: null,
      hasBackend: false, backendNote: null, buildProducer: "scaffold", stateFile: "/x/.thought-layer/state.json",
    });
    expect(rec.app).toBe("thought-layer");
    expect(rec.kind).toBe("deploy");
    expect(rec.version).toBe(1);
    expect(rec.provider).toBe("netlify");
    expect(rec.mode).toBe("dry-run");
  });
});

describe("runDeploy dry run", () => {
  it("walks the publish dir from build.json and plans the deploy with no network", async () => {
    const root = mkdtempSync(join(tmpdir(), "tl-deploy-"));
    mkdirSync(join(root, ".thought-layer"), { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, ".thought-layer", "state.json"), JSON.stringify({ app: "thought-layer", state: {} }));
    writeFileSync(
      join(root, ".thought-layer", "build.json"),
      JSON.stringify({ app: "thought-layer", kind: "build", version: 1, producer: "scaffold", publishDir: "dist", entry: "index.html", hasBackend: false, backendNote: null }),
    );
    writeFileSync(join(root, "dist", "index.html"), "<!doctype html><title>x</title>");
    writeFileSync(join(root, "dist", "robots.txt"), "User-agent: *\nAllow: /\n");

    const r = await runDeploy({ path: join(root, ".thought-layer", "state.json"), dryRun: true }, { deployedAt: "2026-06-17T00:00:00.000Z" });
    expect(r.ok).toBe(true);
    expect(r.details["dryRun"]).toBe(true);
    expect(r.details["fileCount"]).toBe(2);
    expect((r.details["files"] as string[]).sort()).toEqual(["/index.html", "/robots.txt"]);
    // dry run never writes a deploy.json record.
    expect(existsSync(join(root, ".thought-layer", "deploy.json"))).toBe(false);
  });

  it("errors clearly when build.json is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "tl-deploy-"));
    mkdirSync(join(root, ".thought-layer"), { recursive: true });
    writeFileSync(join(root, ".thought-layer", "state.json"), JSON.stringify({ app: "thought-layer", state: {} }));
    const r = await runDeploy({ path: join(root, ".thought-layer", "state.json"), dryRun: true }, { deployedAt: "2026-06-17T00:00:00.000Z" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("No build.json");
  });
});
