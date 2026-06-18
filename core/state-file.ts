// Node filesystem layer for the portable progress file. The pure transforms
// live in progress.ts; this is the thin IO both frontends share - the Pi
// tl_state tool and the CLI bin. Kept out of progress.ts so the transforms stay
// testable without touching disk.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  parseProgress, buildProgress, serializeProgress, emptyState,
  type ProgressState, type ProgressPayload, type Writer,
} from "./progress.ts";

export const STATE_DIR = ".thought-layer";
export const STATE_FILE = "state.json";

// Resolve the canonical state file path. `target` may be a project directory or
// a direct path to a .json file; defaults to <cwd>/.thought-layer/state.json.
export function resolveStatePath(target?: string, cwd: string = process.cwd()): string {
  if (!target) return join(cwd, STATE_DIR, STATE_FILE);
  const abs = isAbsolute(target) ? target : resolve(cwd, target);
  return abs.endsWith(".json") ? abs : join(abs, STATE_DIR, STATE_FILE);
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
