// Node filesystem layer for the portable progress file. The pure transforms
// live in progress.ts; this is the thin IO both frontends share - the Pi
// tl_state tool and the CLI bin. Kept out of progress.ts so the transforms stay
// testable without touching disk.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  parseProgress, buildProgress, serializeProgress, emptyState,
  type ProgressState, type ProgressPayload, type Writer,
} from "./progress.ts";

export const STATE_DIR = ".thought-layer";
export const STATE_FILE = "state.json";
// Set THOUGHT_LAYER_STATE to a file path to make it the session default, so the
// agent or user does not have to pass --path on every op when juggling several
// ideas. Precedence: an explicit target (--path / the tool's `path`) wins, then
// the env var, then <cwd>/.thought-layer/state.json.
export const STATE_ENV = "THOUGHT_LAYER_STATE";

const withEnv = (target?: string): string | undefined => target ?? (process.env[STATE_ENV] || undefined);

// Resolve the canonical state file path. `target` may be a project directory or
// a direct path to a .json file; with neither, falls back to the env default or
// <cwd>/.thought-layer/state.json.
export function resolveStatePath(target?: string, cwd: string = process.cwd()): string {
  const t = withEnv(target);
  if (!t) return join(cwd, STATE_DIR, STATE_FILE);
  const abs = isAbsolute(t) ? t : resolve(cwd, t);
  return abs.endsWith(".json") ? abs : join(abs, STATE_DIR, STATE_FILE);
}

// List the state files under <dir>/.thought-layer/ so several ideas can live
// side by side and be discovered. `dir` is a project directory (defaults to cwd).
export function listStateFiles(dir: string = process.cwd()): Array<{ name: string; path: string }> {
  const d = join(dir, STATE_DIR);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((name) => ({ name, path: join(d, name) }));
}

export interface LoadResult {
  path: string;
  exists: boolean;
  payload: ProgressPayload;
  state: ProgressState;
}

// Read the state file. A missing file is not an error: it returns an empty
// state so the caller can start a fresh run and write it on first save.
export function loadStateFile(target?: string, cwd?: string): LoadResult {
  const path = resolveStatePath(target, cwd);
  if (!existsSync(path)) {
    const state = emptyState();
    return { path, exists: false, payload: buildProgress(state, { kind: "kit", ts: 0 }, ""), state };
  }
  const payload = parseProgress(readFileSync(path, "utf8"));
  return { path, exists: true, payload, state: payload.state };
}

// Write the state file, stamping the kit writer + an ISO exportedAt. Creates the
// .thought-layer directory on first write.
export function saveStateFile(
  state: ProgressState,
  opts: { target?: string; cwd?: string; version?: string; ts: number; exportedAt: string },
): { path: string; bytes: number } {
  const path = resolveStatePath(opts.target, opts.cwd);
  mkdirSync(dirname(path), { recursive: true });
  const writer: Writer = { kind: "kit", ts: opts.ts };
  if (opts.version) writer.version = opts.version;
  const text = serializeProgress(buildProgress(state, writer, opts.exportedAt));
  writeFileSync(path, text);
  return { path, bytes: Buffer.byteLength(text) };
}
