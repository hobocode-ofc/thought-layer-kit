// The single dispatch for every progress-file operation, shared by both
// frontends - the Pi tl_state tool and the CLI bin - so they can never drift.
// The model (or the shell) supplies a payload of prose + numbers; this builds
// the exact on-disk objects via core/progress.ts and writes through
// core/state-file.ts. Pure of any host concern (no Pi types, no argv).

import { gradeFromConfidence } from "./scoring.ts";
import { loadStateFile, saveStateFile, listStateFiles, STATE_DIR, STATE_ENV } from "./state-file.ts";
import {
  setAnswer, setArtifact, setCursor, parkNote, buildFeedbackEntry,
  normalizeArtifactValue, summarizeState,
  type ArtifactKey, type PersonaInput, type EndState, type KitCursor,
} from "./progress.ts";

export const ARTIFACT_KEYS: ArtifactKey[] = ["bizModel", "grill", "assets", "research", "swot", "prd", "naming", "brand"];
const END_STATES: EndState[] = ["open", "pass", "setAside"];

export interface StateOp {
  op: string;
  path?: string;
  qId?: string;
  value?: unknown;
  artifact?: string;
  mode?: string;
  personas?: PersonaInput[];
  endState?: string;
  round?: number;
  cursor?: KitCursor;
  key?: string;
  note?: string;
}

export interface StateOpResult {
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
}

export function applyStateOp(p: StateOp, ctx: { ts: number; exportedAt: string }): StateOpResult {
  const { ts, exportedAt } = ctx;
  const fail = (message: string): StateOpResult => ({ ok: false, message, details: {} });
  try {
    if (p.op === "list") {
      const files = listStateFiles(p.path);
      if (!files.length) {
        return { ok: true, message: `No state files under ./${STATE_DIR}/. A fresh run creates ${STATE_DIR}/state.json; pass --path <file>.json (or set ${STATE_ENV}) to use another.`, details: { files: [] } };
      }
      const rows = files.map((f) => {
        try {
          const sum = summarizeState(loadStateFile(f.path).state);
          return { name: f.name, path: f.path, answered: sum.answered, artifacts: sum.artifacts };
        } catch {
          return { name: f.name, path: f.path, answered: 0, artifacts: [] as string[], unreadable: true };
        }
      });
      const lines = rows.map((r) => `  ${r.name} - ${r.answered} answered${r.artifacts.length ? `, artifacts: ${r.artifacts.join(", ")}` : ""}${("unreadable" in r) ? " (unreadable)" : ""}`).join("\n");
      return { ok: true, message: `${files.length} state file(s) under ./${STATE_DIR}/:\n${lines}\nPick one with --path .thought-layer/<name>.json, or set ${STATE_ENV} for the session.`, details: { files: rows } };
    }

    const loaded = loadStateFile(p.path);
    const save = (next: typeof loaded.state) => saveStateFile(next, { target: p.path, ts, exportedAt }).path;

    if (p.op === "read" || p.op === "export") {
      const sum = summarizeState(loaded.state);
      let message: string;
      if (loaded.exists) {
        message = `Loaded ${loaded.path}: ${sum.answered}/${sum.totalAnswerable} answered ` +
          `(${sum.byStatus.green} green, ${sum.byStatus.yellow} yellow, ${sum.byStatus.red} red), ` +
          `artifacts: ${sum.artifacts.join(", ") || "none"}. ` +
          `Resume at ${sum.cursor ? `stage ${sum.cursor.backboneStage ?? "?"} (${sum.cursor.phase ?? "?"})` : "the beginning"}.`;
      } else {
        const others = listStateFiles().filter((f) => f.path !== loaded.path);
        const hint = others.length ? ` Other state files here: ${others.map((f) => f.name).join(", ")} (pick one with --path, or 'tl list').` : "";
        message = `No state file yet at ${loaded.path}.${hint} Start a fresh run; it will be created on first write.`;
      }
      return { ok: true, message, details: { path: loaded.path, exists: loaded.exists, summary: sum, state: loaded.state } };
    }

    if (p.op === "answer") {
      if (!p.qId || typeof p.value !== "string") return fail("answer needs a qId and a string value.");
      const path = save(setAnswer(loaded.state, p.qId, p.value, ts));
      return { ok: true, message: `Recorded answer for "${p.qId}" and saved ${path}.`, details: { path, qId: p.qId } };
    }

    if (p.op === "feedback") {
      if (!p.qId || !p.personas?.length) return fail("feedback needs a qId and at least one persona.");
      const endState = (END_STATES as string[]).includes(p.endState || "") ? (p.endState as EndState) : "open";
      const mode = p.mode || (p.personas.length > 1 ? "panel" : p.personas[0]!.persona);
      const entry = buildFeedbackEntry({ mode, personas: p.personas, endState, round: p.round, ts });
      const next = { ...loaded.state, feedback: { ...loaded.state.feedback, [p.qId]: entry } };
      const path = save(next);
      const grade = gradeFromConfidence(entry.confidence);
      const pct = entry.confidence != null ? `${(entry.confidence * 100).toFixed(0)}%` : "n/a";
      const tail = endState === "setAside" ? `, set aside with ${entry.todos.length} to-do(s)` : endState === "pass" ? ", cleared the bar" : "";
      return {
        ok: true,
        message: `Recorded panel verdict for "${p.qId}": confidence ${pct} -> ${entry.status}, grade ${grade}${tail}. Saved ${path}.`,
        details: { path, qId: p.qId, confidence: entry.confidence, status: entry.status, grade },
      };
    }

    if (p.op === "artifact") {
      const key = p.artifact as ArtifactKey;
      if (!ARTIFACT_KEYS.includes(key)) return fail(`artifact needs a key in: ${ARTIFACT_KEYS.join(", ")}.`);
      if (p.value == null) return fail("artifact needs a value object.");
      const path = save(setArtifact(loaded.state, key, normalizeArtifactValue(key, p.value), ts));
      return { ok: true, message: `Stored ${key} artifact and saved ${path}.`, details: { path, artifact: key } };
    }

    if (p.op === "cursor") {
      if (!p.cursor) return fail("cursor needs a cursor object.");
      const path = save(setCursor(loaded.state, p.cursor, ts));
      return { ok: true, message: `Saved resume cursor (stage ${p.cursor.backboneStage ?? "?"}, ${p.cursor.phase ?? "?"}) to ${path}.`, details: { path } };
    }

    if (p.op === "park") {
      if (!p.key || !p.note) return fail("park needs a key and a note.");
      const path = save(parkNote(loaded.state, p.key, p.note, ts));
      return { ok: true, message: `Parked a note under "${p.key}" and saved ${path}.`, details: { path, key: p.key } };
    }

    return fail(`Unknown op "${p.op}". Use read, answer, feedback, artifact, cursor, park, or export.`);
  } catch (e) {
    return fail(`tl_state error: ${(e as Error).message}`);
  }
}
