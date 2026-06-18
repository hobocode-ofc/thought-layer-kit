// Node IO for the git-backed session sync, shared by the `tl sync` CLI and the
// tl_sync Pi tool. The pure transforms live in sync.ts and merge.ts; this is the
// git/gh shell-out layer (spawnSync, an args array, no shell), mirroring the
// Netlify CLI delegation in deploy-io.ts.
//
// Git is transport + history + multi-user ONLY. The kit owns every byte of JSON
// reconciliation via mergeProgressStates, and a .gitattributes line pins the
// session files to merge=ours so git never textually merges the envelope.
// Collaboration is delegated entirely to GitHub: the kit adds collaborators to
// NOTHING (no gh api permissions call); init just prints the repo URL and a
// pointer that the user grants access on GitHub themselves.
//
// Secrets: nothing here reads or writes a token. gh uses its own keyring and git
// its credential helper; no token is ever placed on argv or persisted. Session
// state holds validation/design data, never secrets.
//
// Copy rule: no em-dashes, no en-dashes, no spaced hyphen dashes in any message.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  slugify, parseSyncConfig, serializeSyncConfig, emptySyncConfig, selectWorkspace, defaultSessionsDir,
  parseGitStatus, type SyncConfig, type SyncWorkspace,
} from "./sync.ts";
import { STATE_DIR, listStateFiles, loadStateFile, saveStateFile, resolveStatePath } from "./state-file.ts";
import { summarizeState, parseProgress, buildProgress, serializeProgress } from "./progress.ts";
import { mergeProgressStates } from "./merge.ts";
import type { StateOpResult } from "./state-ops.ts";

export interface SyncRunOptions {
  op: string; // init | save | list | open | pull | push | status
  name?: string; // session name (save/open) or workspace label (init)
  repo?: string; // init: the GitHub repo to clone or create (owner/name or URL)
  dir?: string; // explicit clone dir
  workspace?: string; // select an existing workspace by label
  message?: string; // commit message
  noPush?: boolean; // commit only, do not push
  path?: string; // current working state file (save reads from here)
}

// ---- probes (guided fallbacks, like hasNetlifyCli/cliLoggedIn) ---------------

export function hasGit(): boolean {
  try { return spawnSync("git", ["--version"], { encoding: "utf8", timeout: 15000 }).status === 0; }
  catch { return false; }
}
export function hasGh(): boolean {
  try { return spawnSync("gh", ["--version"], { encoding: "utf8", timeout: 15000 }).status === 0; }
  catch { return false; }
}
export function ghAuthed(): boolean {
  try { return spawnSync("gh", ["auth", "status"], { encoding: "utf8", timeout: 20000 }).status === 0; }
  catch { return false; }
}

// ---- config IO ---------------------------------------------------------------

function syncConfigPath(): string {
  return process.env["THOUGHT_LAYER_SYNC_CONFIG"] || join(homedir(), ".thought-layer", "sync.json");
}
function loadConfig(): SyncConfig {
  const p = syncConfigPath();
  if (!existsSync(p)) return emptySyncConfig();
  try { return parseSyncConfig(readFileSync(p, "utf8")); }
  catch { return emptySyncConfig(); }
}
function saveConfig(cfg: SyncConfig): void {
  const p = syncConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeSyncConfig(cfg));
}

// ---- git helpers -------------------------------------------------------------

interface Run { status: number; out: string; err: string; }
function git(dir: string | null, args: string[], timeout = 120000): Run {
  const r = spawnSync("git", dir ? ["-C", dir, ...args] : args, { encoding: "utf8", timeout });
  return { status: r.status ?? 1, out: r.stdout || "", err: r.stderr || "" };
}
function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git")) && git(dir, ["rev-parse", "--is-inside-work-tree"]).status === 0;
}
function dirNonEmpty(dir: string): boolean {
  try { return existsSync(dir) && readdirSync(dir).length > 0; }
  catch { return false; }
}
const absDir = (d: string, cwd = process.cwd()): string => (isAbsolute(d) ? d : resolve(cwd, d));

// ---- the clone scaffolding files written on init -----------------------------

const GITATTRIBUTES = `# The kit reconciles session JSON itself; never let git textually merge it\n# (which would corrupt the envelope). -merge keeps our copy in the working tree\n# on a conflict; the kit then rebuilds the merged result from the clean blobs.\n.thought-layer/*.json -merge\n`;
const GITIGNORE = `# A Thought Layer sessions repo holds session state only. Built product\n# artifacts and secrets never sync here.\nbuild.json\ndeploy.json\n*.local\n.env\n.env.*\n!.env.example\ndist/\n.netlify/\nnode_modules/\n`;
const README = `# Thought Layer sessions\n\nThis private repo is the home for Thought Layer session files. Each session is one\nfile under \`.thought-layer/<name>.json\` (the portable validation and design state).\nUse the kit to work with them:\n\n    tl sync open --name <session>     pull and resume a session\n    tl sync save --name <session>     snapshot the current state, commit, and push\n    tl sync list                      list the sessions in this repo\n\nCollaboration is handled by GitHub: add a collaborator to this repo in its GitHub\nsettings, and they can clone it and run the kit against the same sessions.\nThe kit reconciles concurrent edits itself (newest wins per field, conflicts are\nreported), so git never has to merge the JSON by hand.\n`;

function writeCloneScaffold(cloneDir: string): void {
  mkdirSync(join(cloneDir, STATE_DIR), { recursive: true });
  const put = (name: string, body: string): void => {
    const p = join(cloneDir, name);
    if (!existsSync(p)) writeFileSync(p, body);
  };
  put(".gitattributes", GITATTRIBUTES);
  put(".gitignore", GITIGNORE);
  put("README.md", README);
}

// ---- result helpers ----------------------------------------------------------

const ok = (message: string, details: Record<string, unknown> = {}): StateOpResult => ({ ok: true, message, details });
const fail = (message: string, details: Record<string, unknown> = {}): StateOpResult => ({ ok: false, message, details });

const collaboratorPointer = (repo: string): string =>
  `To collaborate, add people to ${repo} in its GitHub settings (Settings, Collaborators). They clone it and run the kit; the kit never changes GitHub permissions.`;

// ---- the orchestrator --------------------------------------------------------

export async function runSync(opts: SyncRunOptions, ctx: { ts: number; exportedAt: string }): Promise<StateOpResult> {
  if (!hasGit()) {
    return fail("git is not installed. Install git, then re-run. The sync feature stores your session files in your own private GitHub repo.", { needs: "git" });
  }
  try {
    switch (opts.op) {
      case "init": return syncInit(opts);
      case "save": return syncSave(opts, ctx);
      case "list": return syncList(opts);
      case "open": return syncOpen(opts, ctx);
      case "pull": return syncPull(opts, ctx);
      case "push": return syncPush(opts);
      case "status": return syncStatus(opts);
      default: return fail(`Unknown sync op "${opts.op}". Use one of: init, save, list, open, pull, push, status.`);
    }
  } catch (e) {
    return fail(`Sync ${opts.op} failed: ${(e as Error).message}`);
  }
}

// Resolve the workspace + clone dir an op targets (everything except init).
function resolveWorkspace(opts: SyncRunOptions, cfg: SyncConfig): { cloneDir: string; ws: SyncWorkspace | null } {
  if (opts.dir && opts.dir.trim()) return { cloneDir: absDir(opts.dir), ws: null };
  const env = process.env["THOUGHT_LAYER_SESSIONS_DIR"];
  if (env && env.trim()) return { cloneDir: absDir(env), ws: null };
  const ws = selectWorkspace(cfg, opts.workspace);
  if (ws) return { cloneDir: ws.cloneDir, ws };
  return { cloneDir: defaultSessionsDir(homedir()), ws: null };
}

// ---- init --------------------------------------------------------------------

function syncInit(opts: SyncRunOptions): StateOpResult {
  const repo = (opts.repo || "").trim();
  if (!repo) return fail("Pass the private repo to use: tl sync init --repo <owner/name or url> [--name <label>] [--dir <path>].");

  const home = homedir();
  const label = (opts.name || "").trim();
  const cloneDir = opts.dir
    ? absDir(opts.dir)
    : !label || slugify(label) === "personal"
      ? defaultSessionsDir(home)
      : join(home, ".thought-layer", `sessions-${slugify(label)}`);

  if (dirNonEmpty(cloneDir)) {
    if (isGitRepo(cloneDir)) return fail(`${cloneDir} is already a git repo. It looks initialized; use tl sync list or pick another --dir.`, { cloneDir });
    return fail(`${cloneDir} already exists and is not empty. Pick another --dir or remove it first.`, { cloneDir });
  }

  // Owner/name (no scheme) routes through gh when available; a URL or local path
  // routes through plain git clone.
  const isOwnerName = /^[\w.-]+\/[\w.-]+$/.test(repo);
  const useGh = isOwnerName && hasGh() && ghAuthed();

  mkdirSync(dirname(cloneDir), { recursive: true });
  let cloned = false;
  if (useGh) {
    cloned = spawnSync("gh", ["repo", "clone", repo, cloneDir], { encoding: "utf8", timeout: 180000 }).status === 0;
    if (!cloned) {
      // Repo may not exist yet: create it private (in the user's account), then clone.
      const created = spawnSync("gh", ["repo", "create", repo, "--private"], { encoding: "utf8", timeout: 180000 });
      if (created.status !== 0) {
        return fail(`Could not clone or create ${repo} with gh. Create the private repo on GitHub yourself, then re-run. gh said: ${(created.stderr || "").slice(0, 300)}`);
      }
      cloned = spawnSync("gh", ["repo", "clone", repo, cloneDir], { encoding: "utf8", timeout: 180000 }).status === 0;
    }
  } else {
    const url = isOwnerName ? `https://github.com/${repo}.git` : repo;
    cloned = git(null, ["clone", url, cloneDir], 180000).status === 0;
    if (!cloned) {
      return fail(
        isOwnerName && !hasGh()
          ? `Could not clone https://github.com/${repo}.git. Create the private repo on GitHub first (or install gh and run gh auth login so the kit can create it), then re-run.`
          : `Could not clone ${repo}. Check the repo path or URL and your git access, then re-run.`,
        { repo, cloneDir },
      );
    }
  }

  // Scaffold the clone and make the first commit if anything is new.
  writeCloneScaffold(cloneDir);
  git(cloneDir, ["add", "-A"]);
  const committed = git(cloneDir, ["commit", "-m", "Initialize Thought Layer sessions"]).status === 0;
  let branch = git(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim() || "main";
  if (committed && branch === "HEAD") { git(cloneDir, ["branch", "-M", "main"]); branch = "main"; }
  let pushed = false;
  if (committed) pushed = git(cloneDir, ["push", "-u", "origin", branch]).status === 0;

  // Record the workspace and make it active.
  const cfg = loadConfig();
  const wsName = label || "personal";
  const ws: SyncWorkspace = { name: wsName, repo, defaultBranch: branch, cloneDir };
  cfg.workspaces = [...cfg.workspaces.filter((w) => w.cloneDir !== cloneDir && w.name !== wsName), ws];
  cfg.activeWorkspace = wsName;
  saveConfig(cfg);

  return ok(
    `Initialized the "${wsName}" sessions workspace at ${cloneDir} (repo ${repo}).` +
      `${committed ? (pushed ? " Pushed the initial commit." : " Committed locally; push it once your git access is set.") : " The repo already had content; left it as is."}` +
      `\n${collaboratorPointer(repo)}` +
      `\nSave your first session with: tl sync save --name <name>${label ? ` --workspace ${wsName}` : ""}.`,
    { cloneDir, repo, workspace: wsName, branch, committed, pushed },
  );
}

// ---- save --------------------------------------------------------------------

function syncSave(opts: SyncRunOptions, ctx: { ts: number; exportedAt: string }): StateOpResult {
  const cfg = loadConfig();
  const { cloneDir, ws } = resolveWorkspace(opts, cfg);
  if (!isGitRepo(cloneDir)) return fail(`No sessions workspace at ${cloneDir}. Run tl sync init --repo <owner/name> first.`, { cloneDir });

  const slug = slugify(opts.name || ws?.activeSession?.replace(/\.json$/, "") || "");
  if (!slug) return fail("Name the session: tl sync save --name <name> (for example photobooth, peptide, blogging).");

  // Snapshot the current working state into the clone under <slug>.json. Source
  // precedence: an explicit --path or THOUGHT_LAYER_STATE wins (snapshot a
  // separate project's state into this named session); otherwise, if the session
  // file already exists, snapshot it in place (the "work directly in the clone"
  // flow, so save is just commit + push); otherwise start from the default.
  const targetPath = join(cloneDir, STATE_DIR, `${slug}.json`);
  const existed = existsSync(targetPath);
  const useExplicit = !!((opts.path && opts.path.trim()) || (process.env["THOUGHT_LAYER_STATE"] || "").trim());
  const loadTarget = useExplicit ? opts.path : existed ? targetPath : opts.path;
  const source = loadStateFile(loadTarget).state;
  saveStateFile(source, { target: targetPath, ts: ctx.ts, exportedAt: ctx.exportedAt });

  git(cloneDir, ["add", "-A"]);
  const msg = opts.message || `${existed ? "Update" : "Save"} session ${slug}`;
  const commit = git(cloneDir, ["commit", "-m", msg]);
  const committed = commit.status === 0;
  let pushed = false;
  let pushNote = "";
  if (committed && !opts.noPush) {
    const p = git(cloneDir, ["push"]);
    pushed = p.status === 0;
    if (!pushed) pushNote = ` Could not push (${(p.err || "").split("\n")[0] || "see git output"}); commit is local, run tl sync push when ready.`;
  }

  // Record the active session for this workspace.
  if (ws) {
    ws.activeSession = `${slug}.json`;
    saveConfig(cfg);
  }

  return ok(
    `${existed ? "Updated" : "Saved"} session ${slug} in ${cloneDir}.` +
      `${committed ? (opts.noPush ? " Committed locally (no push)." : pushed ? " Committed and pushed." : pushNote) : " Nothing changed since the last save."}`,
    { cloneDir, session: `${slug}.json`, path: targetPath, committed, pushed },
  );
}

// ---- list --------------------------------------------------------------------

function syncList(opts: SyncRunOptions): StateOpResult {
  const cfg = loadConfig();
  const { cloneDir } = resolveWorkspace(opts, cfg);
  if (!isGitRepo(cloneDir)) return fail(`No sessions workspace at ${cloneDir}. Run tl sync init --repo <owner/name> first.`, { cloneDir });
  const files = listStateFiles(cloneDir);
  if (!files.length) return ok(`No sessions yet in ${cloneDir}. Create one with tl sync save --name <name>.`, { cloneDir, sessions: [] });
  const rows = files.map((f) => {
    try {
      const sum = summarizeState(loadStateFile(f.path).state);
      return { name: f.name, path: f.path, answered: sum.answered, artifacts: sum.artifacts };
    } catch {
      return { name: f.name, path: f.path, answered: 0, artifacts: [] as string[], unreadable: true };
    }
  });
  // Dash-free rows (the state-ops list render uses a banned " - ").
  const lines = rows
    .map((r) => `  ${r.name}: ${r.answered} answered${r.artifacts.length ? `, artifacts ${r.artifacts.join(", ")}` : ""}${"unreadable" in r ? " (unreadable)" : ""}`)
    .join("\n");
  return ok(`${files.length} session(s) in ${cloneDir}:\n${lines}\nOpen one with tl sync open --name <name>.`, { cloneDir, sessions: rows });
}

// ---- open --------------------------------------------------------------------

function syncOpen(opts: SyncRunOptions, ctx: { ts: number; exportedAt: string }): StateOpResult {
  const cfg = loadConfig();
  const { cloneDir, ws } = resolveWorkspace(opts, cfg);
  if (!isGitRepo(cloneDir)) return fail(`No sessions workspace at ${cloneDir}. Run tl sync init --repo <owner/name> first.`, { cloneDir });
  const slug = slugify(opts.name || "");
  if (!slug) return fail("Name the session to open: tl sync open --name <name>. List them with tl sync list.");

  const pullResult = pullAndReconcile(cloneDir, ctx);
  const targetPath = join(cloneDir, STATE_DIR, `${slug}.json`);
  if (!existsSync(targetPath)) {
    return fail(`No session "${slug}" in ${cloneDir} after pulling. List them with tl sync list, or create it with tl sync save --name ${slug}.`, { cloneDir });
  }
  if (ws) { ws.activeSession = `${slug}.json`; saveConfig(cfg); }

  return ok(
    `Opened session ${slug} (pulled latest${pullResult.merged ? `, reconciled local and remote edits${pullResult.coarse.length ? ` (review: ${pullResult.coarse.join(", ")})` : ""}` : ""}).` +
      `\nWork on it by pointing the kit at this file:` +
      `\n  export THOUGHT_LAYER_STATE="${targetPath}"` +
      `\nor pass --path "${targetPath}" to tl read/answer/artifact. Save with tl sync save --name ${slug}.`,
    { cloneDir, session: `${slug}.json`, path: targetPath, merged: pullResult.merged, coarse: pullResult.coarse },
  );
}

// ---- pull (with kit reconciliation) ------------------------------------------

interface PullResult { merged: boolean; coarse: string[]; note: string; }

// Pull and reconcile. Deterministic via merge-base, NOT git's merge exit code:
// fast-forward and ahead-only are handled directly, and on true divergence the
// kit rebuilds every changed session file from the two clean committed blobs
// (ignoring whatever git left in the conflicted working tree), takes the remote
// copy of any non-session file, and records a real two-parent merge commit.
function pullAndReconcile(cloneDir: string, ctx: { ts: number; exportedAt: string }): PullResult {
  const branch = git(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim() || "main";
  if (git(cloneDir, ["fetch", "origin", branch], 120000).status !== 0) {
    return { merged: false, coarse: [], note: "no remote branch to fetch yet" };
  }
  const local = git(cloneDir, ["rev-parse", "HEAD"]).out.trim();
  const remote = git(cloneDir, ["rev-parse", `origin/${branch}`]).out.trim();
  if (!remote || local === remote) return { merged: false, coarse: [], note: "up to date" };
  const base = git(cloneDir, ["merge-base", local, remote]).out.trim();
  if (base === remote) return { merged: false, coarse: [], note: "local is ahead; nothing to pull" };
  if (base === local) {
    git(cloneDir, ["merge", "--ff-only", `origin/${branch}`], 120000);
    return { merged: false, coarse: [], note: "fast-forward" };
  }

  // True divergence. Start the merge (do not let it commit), then resolve every
  // differing path ourselves from the two clean blobs.
  const changed = git(cloneDir, ["diff", "--name-only", local, remote]).out.split("\n").map((s) => s.trim()).filter(Boolean);
  git(cloneDir, ["merge", "--no-ff", "--no-commit", `origin/${branch}`], 120000);
  const coarseAll: string[] = [];
  let reconciled = 0;
  for (const rel of changed) {
    if (rel.startsWith(`${STATE_DIR}/`) && rel.endsWith(".json")) {
      const ours = readShow(cloneDir, local, rel);
      const theirs = readShow(cloneDir, remote, rel);
      if (ours && theirs) {
        try {
          const op = parseProgress(ours);
          const tp = parseProgress(theirs);
          const { state, coarse } = mergeProgressStates(op.state, tp.state, { oursTs: op.writer?.ts ?? 0, theirsTs: tp.writer?.ts ?? 0 });
          writeFileSync(join(cloneDir, rel), serializeProgress(buildProgress(state, { kind: "kit", ts: ctx.ts }, ctx.exportedAt)));
          coarseAll.push(...coarse);
          reconciled++;
        } catch {
          if (theirs) writeFileSync(join(cloneDir, rel), theirs);
        }
      } else if (theirs && !ours) {
        writeFileSync(join(cloneDir, rel), theirs);
        reconciled++;
      }
    } else {
      // Non-session file: take the remote copy (session JSON is the only thing
      // the kit reconciles; everything else follows the remote).
      const theirs = readShow(cloneDir, remote, rel);
      if (theirs !== null) writeFileSync(join(cloneDir, rel), theirs);
    }
    git(cloneDir, ["add", "--", rel]);
  }
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "--no-edit", "-m", "Reconcile sessions (kit merge)"]);
  return { merged: reconciled > 0, coarse: Array.from(new Set(coarseAll)).sort(), note: `reconciled ${reconciled} session file(s)` };
}

function readShow(cloneDir: string, ref: string, rel: string): string | null {
  const r = git(cloneDir, ["show", `${ref}:${rel}`]);
  return r.status === 0 ? r.out : null;
}

function syncPull(opts: SyncRunOptions, ctx: { ts: number; exportedAt: string }): StateOpResult {
  const cfg = loadConfig();
  const { cloneDir } = resolveWorkspace(opts, cfg);
  if (!isGitRepo(cloneDir)) return fail(`No sessions workspace at ${cloneDir}. Run tl sync init first.`, { cloneDir });
  const r = pullAndReconcile(cloneDir, ctx);
  const push = git(cloneDir, ["push"]);
  return ok(
    `Pulled ${cloneDir}.` +
      `${r.merged ? ` Reconciled local and remote edits${r.coarse.length ? ` (a coarse tie-break dropped one side for: ${r.coarse.join(", ")})` : ""}.` : " Already up to date or fast-forwarded."}` +
      `${r.merged && push.status === 0 ? " Pushed the reconciliation." : ""}`,
    { cloneDir, merged: r.merged, coarse: r.coarse },
  );
}

// ---- push --------------------------------------------------------------------

function syncPush(opts: SyncRunOptions): StateOpResult {
  const cfg = loadConfig();
  const { cloneDir } = resolveWorkspace(opts, cfg);
  if (!isGitRepo(cloneDir)) return fail(`No sessions workspace at ${cloneDir}. Run tl sync init first.`, { cloneDir });
  git(cloneDir, ["add", "-A"]);
  const committed = git(cloneDir, ["commit", "-m", opts.message || "Sync sessions"]).status === 0;
  const p = git(cloneDir, ["push"]);
  if (p.status !== 0) return fail(`Push failed: ${(p.err || "").split("\n")[0] || "see git output"}. Pull first (tl sync pull), then push.`, { cloneDir });
  return ok(`Pushed ${cloneDir}.${committed ? " Committed pending changes." : " Nothing new to commit; pushed any local commits."}`, { cloneDir, committed });
}

// ---- status ------------------------------------------------------------------

function syncStatus(opts: SyncRunOptions): StateOpResult {
  const cfg = loadConfig();
  const { cloneDir, ws } = resolveWorkspace(opts, cfg);
  if (!isGitRepo(cloneDir)) {
    const known = cfg.workspaces.length ? ` Known workspaces: ${cfg.workspaces.map((w) => w.name).join(", ")}.` : "";
    return fail(`No sessions workspace at ${cloneDir}. Run tl sync init --repo <owner/name> first.${known}`, { cloneDir, workspaces: cfg.workspaces });
  }
  const st = parseGitStatus(git(cloneDir, ["status", "--porcelain=v1", "--branch"]).out);
  const sessions = listStateFiles(cloneDir).length;
  return ok(
    `Workspace ${ws?.name || "(by dir)"} at ${cloneDir}: ${sessions} session(s), branch ${st.branch || "?"}, ` +
      `${st.ahead} ahead, ${st.behind} behind, ${st.dirty ? `${st.files.length} uncommitted change(s)` : "clean"}.` +
      `${ws?.activeSession ? ` Active session: ${ws.activeSession}.` : ""}`,
    { cloneDir, workspace: ws?.name || null, sessions, ...st },
  );
}
