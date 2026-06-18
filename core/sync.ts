// Pure helpers for the git-backed session sync: slug a human session name into a
// filename, model the machine-local sync config (which private repos and clone
// dirs the user has set up), resolve which clone dir an op targets, and parse
// `git status` output. No fs and no node deps live here; the actual git/gh shell
// outs and config read/write are in sync-io.ts.
//
// Copy rule for any user-facing string: no em-dashes, no en-dashes, no spaced
// hyphen dashes.

// ---- session naming ----------------------------------------------------------

// Turn a human session name ("Photo Booth!", "Peptide v2") into a safe file slug
// ("photo-booth", "peptide-v2"). Lowercase, non [a-z0-9] runs collapse to a
// single hyphen, trimmed, capped. Returns "" for an empty or all-punctuation
// name so the caller can reject it (a session must be named, never timestamped).
export function slugify(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

// ---- machine-local sync config -----------------------------------------------

// A workspace is one (private repo, local clone dir) pair. The user can have
// several: a personal one for their own projects, and one per outside founder
// they collaborate with. The config is machine-local and never committed.
export interface SyncWorkspace {
  name: string; // human label for the workspace (e.g. "personal", "acme-co")
  repo: string; // the GitHub repo, e.g. "hobocode-ofc/tl-sessions" or a URL
  defaultBranch: string; // usually "main"
  cloneDir: string; // absolute path to the local clone
  activeSession?: string; // the <slug>.json last opened in this workspace
}

export interface SyncConfig {
  schema: number;
  activeWorkspace?: string; // workspace name selected when no --dir is given
  workspaces: SyncWorkspace[];
}

export function emptySyncConfig(): SyncConfig {
  return { schema: 1, workspaces: [] };
}

const str = (v: unknown, fb = ""): string => (typeof v === "string" ? v : fb);

// Defensive parse of a hand-editable sync.json. Drops malformed workspaces
// (a workspace needs at least a cloneDir); never throws on junk.
export function parseSyncConfig(text: string): SyncConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return emptySyncConfig();
  }
  const list = Array.isArray(raw["workspaces"]) ? (raw["workspaces"] as unknown[]) : [];
  const workspaces: SyncWorkspace[] = [];
  for (const w of list) {
    if (!w || typeof w !== "object") continue;
    const r = w as Record<string, unknown>;
    const cloneDir = str(r["cloneDir"]).trim();
    if (!cloneDir) continue;
    const ws: SyncWorkspace = {
      name: str(r["name"]).trim() || cloneDir,
      repo: str(r["repo"]).trim(),
      defaultBranch: str(r["defaultBranch"]).trim() || "main",
      cloneDir,
    };
    const active = str(r["activeSession"]).trim();
    if (active) ws.activeSession = active;
    workspaces.push(ws);
  }
  const cfg: SyncConfig = { schema: 1, workspaces };
  const aw = str(raw["activeWorkspace"]).trim();
  if (aw) cfg.activeWorkspace = aw;
  return cfg;
}

export function serializeSyncConfig(cfg: SyncConfig): string {
  return JSON.stringify({ schema: 1, activeWorkspace: cfg.activeWorkspace, workspaces: cfg.workspaces }, null, 2) + "\n";
}

// Find a workspace by name, or fall back to the active one, or the only one.
export function selectWorkspace(cfg: SyncConfig, name?: string): SyncWorkspace | null {
  if (name) return cfg.workspaces.find((w) => w.name === name) || null;
  if (cfg.activeWorkspace) {
    const w = cfg.workspaces.find((ws) => ws.name === cfg.activeWorkspace);
    if (w) return w;
  }
  return cfg.workspaces.length === 1 ? cfg.workspaces[0]! : null;
}

// The default personal clone dir, under one dot-dir off every product tree so it
// can never leak into a product repo. Per-client dirs are explicit cloneDirs
// recorded as workspaces. `home` is passed in to keep this pure.
export function defaultSessionsDir(home: string): string {
  return `${home}/.thought-layer/sessions`;
}

// Resolve the clone dir an op targets. Precedence mirrors resolveStatePath:
// an explicit --dir wins, then the env var, then the selected workspace, then
// the personal default. Returns the absolute dir (relative inputs are the
// caller's responsibility to absolutize).
export function resolveCloneDir(opts: {
  explicit?: string;
  env?: string;
  workspace?: SyncWorkspace | null;
  home: string;
}): string {
  if (opts.explicit && opts.explicit.trim()) return opts.explicit.trim();
  if (opts.env && opts.env.trim()) return opts.env.trim();
  if (opts.workspace?.cloneDir) return opts.workspace.cloneDir;
  return defaultSessionsDir(opts.home);
}

// ---- git status parsing ------------------------------------------------------

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: boolean; // any tracked change or untracked file
  files: string[]; // the changed/untracked paths
}

// Parse `git status --porcelain=v1 --branch`. The first line is a `## ` branch
// header (with optional "[ahead N, behind M]"); the rest are file entries.
export function parseGitStatus(out: string): GitStatus {
  const lines = String(out || "").split("\n").filter((l) => l.length > 0);
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const header = line.slice(3);
      branch = header.split(/\.\.\.| /)[0] || null;
      const a = header.match(/ahead (\d+)/);
      const b = header.match(/behind (\d+)/);
      if (a) ahead = Number(a[1]);
      if (b) behind = Number(b[1]);
    } else {
      files.push(line.slice(3).trim());
    }
  }
  return { branch, ahead, behind, dirty: files.length > 0, files };
}
