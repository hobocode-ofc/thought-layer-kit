// The portable Thought Layer progress file: the interop format shared with the
// web app (src/lib/progressFile.js). An agent reads it to resume a long
// validation run and writes it to hand back to a co-founder using the web app.
//
// This module is the single deterministic source of envelope + feedback-entry
// assembly, so the model never hand-writes the JSON. Hand-written feedback is
// the main way a file gets corrupted (wrong thresholds, missing personas,
// statement-vs-text drift), so the tl_state tool and the CLI both build the
// objects here from prose + numbers the model supplies.
//
// Mirrors the web app's buildProgressPayload / parseProgressFile EXACTLY. Keep
// PROGRESS_FORMAT and KNOWN_STATE_KEYS in sync with src/lib/progressFile.js.

import { aggregateConfidence, statusFromConfidence } from "./scoring.ts";
import type { Status } from "./scoring.ts";
import { isAnswerableQid } from "./stages.ts";
import { ANSWERABLE_QIDS } from "./stage-map.ts";

export const APP = "thought-layer";
export const PROGRESS_FORMAT = 2;

export const KNOWN_STATE_KEYS = [
  "version", "answers", "feedback", "bizModel", "grill",
  "assets", "research", "swot", "prd", "naming", "brand", "governance", "kit",
] as const;

export type ArtifactKey = "bizModel" | "grill" | "assets" | "research" | "swot" | "prd" | "naming" | "brand" | "governance";

export interface Writer { kind: "web" | "kit"; version?: string; ts: number; }

export interface Suggestion { id: string; persona: string; summary: string; patch: string; }

export interface PersonaResult {
  assessment: string;
  confidence: number;
  confidenceRationale: string;
  suggestions: Suggestion[];
}

export interface FeedbackEntry {
  mode: string;
  personas: Record<string, PersonaResult>;
  confidence: number | null;
  status: Status | null;
  assessment: string;
  suggestions: Suggestion[];
  appliedIds: string[];
  todos: Suggestion[];
  round: number;
  overridden: boolean;
  exited: boolean;
  stale: boolean;
  ts: number;
}

export interface KitCursor {
  stage?: "validation" | "model" | "design";
  backboneStage?: number;
  lastQuestionId?: string;
  phase?: string;
}

export interface KitNamespace {
  schema: number;
  cursor?: KitCursor;
  modulesRun?: string[];
  parked?: Record<string, string[]>;
  panelMeta?: Record<string, unknown>;
  updatedAt: number;
}

export interface ProgressState {
  version: number;
  answers: Record<string, unknown>;
  feedback: Record<string, unknown>;
  bizModel: unknown;
  grill: unknown;
  assets: unknown;
  research: unknown;
  swot: unknown;
  prd: unknown;
  naming: unknown;
  brand: unknown;
  governance: unknown;
  kit: KitNamespace | null;
  [extra: string]: unknown;
}

export interface ProgressPayload {
  app: string;
  format: number;
  exportedAt: string;
  writer?: Writer;
  state: ProgressState;
  formatNewer: boolean;
}

// ---- envelope ----------------------------------------------------------------

export function emptyState(): ProgressState {
  return {
    version: 2, answers: {}, feedback: {}, bizModel: null, grill: null,
    assets: null, research: null, swot: null, prd: null, naming: null, brand: null, governance: null, kit: null,
  };
}

// Lenient parse: validate the gate string, accept ANY format (a newer file is
// not rejected), default missing artifacts to null, and preserve unknown keys
// so a file from a newer build round-trips losslessly.
export function parseProgress(text: string): ProgressPayload {
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(text) as Record<string, unknown>; }
  catch { throw new Error("That file isn't valid JSON."); }
  if (payload?.["app"] !== APP || !payload?.["state"]) {
    throw new Error("That file isn't a Thought Layer progress file.");
  }
  const rawFormat = payload["format"];
  const formatNewer = typeof rawFormat === "number" && rawFormat > PROGRESS_FORMAT;
  const s = (payload["state"] && typeof payload["state"] === "object")
    ? payload["state"] as Record<string, unknown> : {};
  const obj = (v: unknown): Record<string, unknown> =>
    (v && typeof v === "object" && !Array.isArray(v)) ? v as Record<string, unknown> : {};
  const state: ProgressState = {
    ...s,
    version: 2,
    answers: obj(s["answers"]),
    feedback: obj(s["feedback"]),
    bizModel: s["bizModel"] ?? null,
    grill: s["grill"] ?? null,
    assets: s["assets"] ?? null,
    research: s["research"] ?? null,
    swot: s["swot"] ?? null,
    prd: s["prd"] ?? null,
    naming: s["naming"] ?? null,
    brand: s["brand"] ?? null,
    governance: s["governance"] ?? null,
    kit: (s["kit"] as KitNamespace | undefined) ?? null,
  };
  return {
    app: APP,
    format: typeof rawFormat === "number" ? rawFormat : PROGRESS_FORMAT,
    exportedAt: typeof payload["exportedAt"] === "string" ? payload["exportedAt"] as string : "",
    writer: payload["writer"] as Writer | undefined,
    state,
    formatNewer,
  };
}

// Assemble the on-disk payload. Pulls known keys explicitly and preserves any
// unknown future key (rest), exactly like the web app's buildProgressPayload.
export function buildProgress(state: Partial<ProgressState>, writer: Writer, exportedAt: string): ProgressPayload {
  const s = (state || {}) as Record<string, unknown>;
  const {
    answers, feedback, bizModel, grill, assets, research, swot, prd, naming, brand, governance, kit,
    version: _v, exportedAt: _ea, formatNewer: _fn, ...rest
  } = s;
  return {
    app: APP,
    format: PROGRESS_FORMAT,
    exportedAt,
    writer,
    formatNewer: false,
    state: {
      version: 2,
      answers: (answers as Record<string, unknown>) || {},
      feedback: (feedback as Record<string, unknown>) || {},
      bizModel: bizModel ?? null,
      grill: grill ?? null,
      assets: assets ?? null,
      research: research ?? null,
      swot: swot ?? null,
      prd: prd ?? null,
      naming: naming ?? null,
      brand: brand ?? null,
      governance: governance ?? null,
      kit: (kit as KitNamespace | undefined) ?? null,
      ...rest,
    },
  };
}

export function serializeProgress(payload: ProgressPayload): string {
  const { formatNewer: _fn, ...wire } = payload;
  return JSON.stringify(wire, null, 2) + "\n";
}

// ---- feedback assembly (the corruption guard) --------------------------------

const clampConfidence = (n: unknown): number =>
  (typeof n === "number" && !Number.isNaN(n)) ? Math.min(1, Math.max(0, n)) : 0.6;

export interface PersonaInput {
  persona: string;
  assessment?: string;
  confidence: number;
  confidenceRationale?: string;
  suggestions?: Array<{ id?: string; summary?: string; patch?: string }>;
}

// "pass" and "open" are byte-identical on disk: the web app derives done from
// confidence >= 0.85 && !stale, so a GENUINE pass must not set overridden (that
// is reserved for an explicit set-aside, which renders "set aside by you").
export type EndState = "open" | "pass" | "setAside";

export function buildFeedbackEntry(opts: {
  mode: string;
  personas: PersonaInput[];
  endState?: EndState;
  round?: number;
  ts: number;
}): FeedbackEntry {
  const { mode, personas: inputs, endState = "open", round = 1, ts } = opts;
  const personas: Record<string, PersonaResult> = {};
  for (const p of inputs) {
    const k = p.persona;
    personas[k] = {
      assessment: p.assessment || "",
      confidence: clampConfidence(p.confidence),
      confidenceRationale: p.confidenceRationale || "",
      suggestions: (p.suggestions || []).slice(0, 3).map((sg, i) => ({
        id: `${k}-${sg.id || `s${i + 1}`}`,
        persona: k,
        summary: sg.summary || "Suggestion",
        patch: sg.patch || "",
      })),
    };
  }
  const keys = Object.keys(personas);
  const confidence = aggregateConfidence(keys.map((k) => personas[k]!.confidence));
  const status = statusFromConfidence(confidence);
  const suggestions = keys.flatMap((k) => personas[k]!.suggestions);
  const assessment = mode !== "panel" && personas[mode] ? personas[mode]!.assessment : "";

  const entry: FeedbackEntry = {
    mode, personas, confidence, status, assessment,
    suggestions, appliedIds: [], todos: [],
    round, overridden: false, exited: false, stale: false, ts,
  };

  if (endState === "setAside") {
    // Mirror QuestionPage.exit(): freeze unresolved suggestions as to-dos and
    // force the dot green (the founder explicitly set this stage aside).
    const seen = new Set<string>();
    const todos = suggestions.filter((sg) => (seen.has(sg.id) ? false : (seen.add(sg.id), true)));
    return { ...entry, overridden: true, exited: true, status: "green", todos };
  }
  return entry;
}

// ---- requirement normalization ----------------------------------------------

// The kit's grill describes a requirement as { id, category, statement }; the
// web app's prd/grill store it as { id, category, text }. Remap on write.
export function normalizeRequirements(
  reqs: Array<{ id?: string; category?: string; statement?: string; text?: string }> | undefined,
): Array<{ id: string; category: string; text: string }> {
  return (reqs || []).map((r, i) => ({
    id: r.id || `r${i + 1}`,
    category: r.category || "functional",
    text: r.text ?? r.statement ?? "",
  }));
}

// Normalize an artifact value on write. For prd/grill, remap the kit's
// requirement `statement` field to the web app's `text` field so the structured
// views render. Everything else passes through untouched.
export function normalizeArtifactValue(key: ArtifactKey, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (key === "prd" || key === "grill") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v["requirements"])) {
      return { ...v, requirements: normalizeRequirements(v["requirements"] as Array<{ id?: string; category?: string; statement?: string; text?: string }>) };
    }
  }
  return value;
}

// ---- resume summary ----------------------------------------------------------

export interface StateSummary {
  answered: number;
  totalAnswerable: number;
  byStatus: { green: number; yellow: number; red: number; ungraded: number };
  artifacts: string[];
  cursor: KitCursor | null;
  modulesRun: string[];
}

const isFilled = (v: unknown): boolean =>
  typeof v === "string" ? v.trim().length > 0
    : Array.isArray(v) ? v.length > 0
      : v != null && typeof v === "object" ? Object.keys(v).length > 0
        : v != null;

export function summarizeState(state: ProgressState): StateSummary {
  const answers = state.answers || {};
  const answered = Object.keys(answers).filter((k) => isFilled(answers[k])).length;
  const byStatus = { green: 0, yellow: 0, red: 0, ungraded: 0 };
  for (const v of Object.values(state.feedback || {})) {
    const fb = v as { status?: string; overridden?: boolean } | null;
    const s = fb?.overridden ? "green" : fb?.status;
    if (s === "green" || s === "yellow" || s === "red") byStatus[s]++;
    else byStatus.ungraded++;
  }
  const artifacts = (["bizModel", "grill", "assets", "research", "swot", "prd", "naming", "brand", "governance"] as const)
    .filter((k) => state[k] != null);
  const kit = (state.kit && typeof state.kit === "object") ? state.kit : null;
  return {
    answered,
    totalAnswerable: ANSWERABLE_QIDS.length,
    byStatus,
    artifacts,
    cursor: kit?.cursor ?? null,
    modulesRun: kit?.modulesRun ?? [],
  };
}

// ---- state mutators (keep the tool + CLI thin and consistent) ----------------

function withKit(state: ProgressState, patch: Partial<KitNamespace>, ts: number): KitNamespace {
  const prev = (state.kit && typeof state.kit === "object") ? state.kit : { schema: 1, updatedAt: ts };
  return { ...prev, ...patch, schema: 1, updatedAt: ts };
}

export function setAnswer(state: ProgressState, qId: string, value: unknown, ts: number): ProgressState {
  if (!isAnswerableQid(qId)) {
    throw new Error(`"${qId}" is not an answerable Thought Layer question id. The agent leaves web-app-only fields to the founder; module sub-stage notes belong in kit.panelMeta.`);
  }
  return { ...state, answers: { ...state.answers, [qId]: value }, kit: withKit(state, {}, ts) };
}

export function setFeedbackEntry(state: ProgressState, qId: string, entry: FeedbackEntry, ts: number): ProgressState {
  return { ...state, feedback: { ...state.feedback, [qId]: entry }, kit: withKit(state, {}, ts) };
}

export function setArtifact(state: ProgressState, key: ArtifactKey, value: unknown, ts: number): ProgressState {
  return { ...state, [key]: value, kit: withKit(state, {}, ts) };
}

export function setCursor(state: ProgressState, cursor: KitCursor, ts: number): ProgressState {
  return { ...state, kit: withKit(state, { cursor }, ts) };
}

// Park a panel note that has no web-app question id (module sub-stage verdicts,
// later-stage concerns surfaced early) under the agent-owned kit namespace.
export function parkNote(state: ProgressState, key: string, note: string, ts: number): ProgressState {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return state; // prototype-pollution guard
  const prev = (state.kit && typeof state.kit === "object") ? state.kit : { schema: 1, updatedAt: ts };
  const parked = { ...(prev.parked || {}) };
  parked[key] = [...(parked[key] || []), note];
  return { ...state, kit: withKit(state, { parked }, ts) };
}
