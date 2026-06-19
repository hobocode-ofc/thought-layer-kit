// Node IO for artifact delivery, shared by the `tl artifacts` CLI and the
// tl_artifacts Pi tool. The pure generation lives in artifacts.ts; this loads a
// session's state, builds the artifact bundle, copies any on-disk build/deploy
// provenance, writes it all under artifacts/<slug>/ in the user's own private
// sessions repo, and commits + pushes via the same git plumbing as sync-io.ts.
//
// Artifacts are generated and overwrite-wins: they are not field-merged like the
// session JSON, and pullAndReconcile already takes the remote copy of any
// non-session file, so this composes cleanly with sync.
//
// Secrets: nothing here reads a token. git uses its credential helper; no token
// is ever placed on argv or persisted.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { git, isGitRepo, loadConfig, resolveWorkspace } from "./sync-io.ts";
import { slugify } from "./sync.ts";
import { STATE_DIR, loadStateFile } from "./state-file.ts";
import { buildArtifactSet, type ArtifactFile, type ArtifactKind } from "./artifacts.ts";
import type { StateOpResult } from "./state-ops.ts";

export interface ArtifactsRunOptions {
  path?: string; // explicit source state file (else the session in the clone)
  name?: string; // session name (the artifacts subfolder slug)
  workspace?: string; // select an existing sessions workspace by label
  dir?: string; // explicit clone dir
  message?: string; // commit message
  noPush?: boolean; // commit only, do not push
  noDeliver?: boolean; // write the bundle into the clone but do not commit/push
  domain?: string; // landing-page domain
  founderName?: string; // landing-page founder
}

const ok = (message: string, details: Record<string, unknown> = {}): StateOpResult => ({ ok: true, message, details });
const fail = (message: string, details: Record<string, unknown> = {}): StateOpResult => ({ ok: false, message, details });

// On-disk build/deploy provenance, looked for relative to the source state file.
// build.json/deploy.json and the .md provenance sit in the .thought-layer/ dir;
// schema.sql/netlify.toml/BACKEND.md sit at the project root beside it.
const STATE_DIR_ARTIFACTS = ["build.json", "deploy.json", "TRACEABILITY.md", "DECISIONS.md"];
const ROOT_ARTIFACTS = ["BACKEND.md", "schema.sql", "netlify.toml", ".env.example"];

const kindOf = (path: string): ArtifactKind =>
  path.endsWith(".md") ? "markdown" : path.endsWith(".svg") ? "svg" : path.endsWith(".html") ? "html" : path.endsWith(".json") ? "json" : "text";

// Parse "owner/name", "https://github.com/owner/name(.git)", or "git@github.com:owner/name"
// into "owner/name". Returns null when it is a local path or unrecognizable.
export function repoOwnerName(repo: string): string | null {
  const m = String(repo || "").trim().match(/(?:github\.com[:/])?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!m) return null;
  if (m[1] === "." || m[1] === "..") return null;
  return `${m[1]}/${m[2]}`;
}

export function runArtifacts(opts: ArtifactsRunOptions, ctx: { generatedAt: string }): StateOpResult {
  try {
    const cfg = loadConfig();
    const { cloneDir, ws } = resolveWorkspace(opts as never, cfg);
    if (!isGitRepo(cloneDir)) {
      return fail(`No sessions workspace at ${cloneDir}. Run tl sync init --repo <owner/name> first, then save a session.`, { cloneDir });
    }

    const slug = slugify(opts.name || ws?.activeSession?.replace(/\.json$/, "") || "");
    if (!slug) return fail("Name the session whose artifacts to deliver: tl artifacts --name <name>.");

    // Source state precedence mirrors sync save: an explicit --path or
    // THOUGHT_LAYER_STATE wins; otherwise the session file in the clone.
    const sessionPath = join(cloneDir, STATE_DIR, `${slug}.json`);
    const useExplicit = !!((opts.path && opts.path.trim()) || (process.env["THOUGHT_LAYER_STATE"] || "").trim());
    const loadTarget = useExplicit ? opts.path : existsSync(sessionPath) ? sessionPath : opts.path;
    const loaded = loadStateFile(loadTarget);
    if (!loaded.exists) {
      return fail(`No session "${slug}" found (looked at ${loaded.path}). Save it first with tl sync save --name ${slug}.`, { cloneDir });
    }

    const { files, manifest } = buildArtifactSet(loaded.state, {
      generatedAt: ctx.generatedAt,
      domain: opts.domain,
      founderName: opts.founderName,
    });

    // Copy any on-disk build/deploy provenance beside the source state file into
    // a Deploy/ subfolder, extending the manifest with each one.
    const srcStateDir = dirname(loaded.path);
    const srcRoot = basename(srcStateDir) === STATE_DIR ? dirname(srcStateDir) : srcStateDir;
    const extra: ArtifactFile[] = [];
    const copyIfPresent = (fromDir: string, fname: string): void => {
      const from = join(fromDir, fname);
      if (!existsSync(from)) return;
      try {
        const content = readFileSync(from, "utf8");
        const rel = `Deploy/${fname}`;
        files[rel] = content;
        extra.push({ path: rel, bytes: Buffer.byteLength(content, "utf8"), kind: kindOf(rel), source: "build/deploy" });
      } catch { /* skip unreadable provenance */ }
    };
    STATE_DIR_ARTIFACTS.forEach((f) => copyIfPresent(srcStateDir, f));
    ROOT_ARTIFACTS.forEach((f) => copyIfPresent(srcRoot, f));
    manifest.files = [...manifest.files, ...extra].sort((a, b) => a.path.localeCompare(b.path));

    // Write the bundle under artifacts/<slug>/ in the clone, plus the manifest.
    const baseRel = join("artifacts", slug);
    const baseAbs = join(cloneDir, baseRel);
    for (const [rel, content] of Object.entries(files)) {
      const dest = join(baseAbs, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
    writeFileSync(join(baseAbs, "artifacts.json"), JSON.stringify(manifest, null, 2) + "\n");

    const fileCount = Object.keys(files).length + 1; // + artifacts.json
    if (opts.noDeliver) {
      return ok(`Generated ${fileCount} artifact file(s) into ${baseAbs} (local only; not committed).`,
        { cloneDir, dir: baseAbs, session: slug, files: Object.keys(files), count: fileCount, committed: false, pushed: false });
    }

    // Force-add past the sessions .gitignore (which ignores dist/, build.json,
    // etc.): the delivered artifacts under artifacts/ are intentionally tracked.
    git(cloneDir, ["add", "-f", "--", baseRel]);
    const msg = opts.message || `Deliver artifacts for ${slug}`;
    const committed = git(cloneDir, ["commit", "-m", msg]).status === 0;
    let pushed = false;
    let pushNote = "";
    if (committed && !opts.noPush) {
      const p = git(cloneDir, ["push"]);
      pushed = p.status === 0;
      if (!pushed) pushNote = ` Could not push (${(p.err || "").split("\n")[0] || "see git output"}); commit is local, run tl sync push when ready.`;
    }

    // Derive clickable GitHub URLs for the wiki to link to.
    const branch = git(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim() || ws?.defaultBranch || "main";
    const ownerName = repoOwnerName(ws?.repo || "");
    const githubBase = ownerName ? `https://github.com/${ownerName}/blob/${branch}/${baseRel}` : null;
    const urls: Record<string, string> = {};
    if (githubBase) for (const rel of Object.keys(files)) urls[rel] = `${githubBase}/${rel.split("/").map(encodeURIComponent).join("/")}`;

    return ok(
      `Delivered ${fileCount} artifact file(s) for "${slug}" to ${baseRel} in ${cloneDir}.` +
        `${committed ? (opts.noPush ? " Committed locally (no push)." : pushed ? " Committed and pushed." : pushNote) : " Nothing changed since the last delivery."}` +
        `${githubBase ? `\nView on GitHub: ${githubBase}` : ""}`,
      { cloneDir, dir: baseRel, session: slug, files: Object.keys(files), count: fileCount, committed, pushed, branch, repo: ownerName, githubBase, urls },
    );
  } catch (e) {
    return fail(`tl_artifacts error: ${(e as Error).message}`);
  }
}
