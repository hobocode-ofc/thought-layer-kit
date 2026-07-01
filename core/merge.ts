// Pure two-way reconciler for the portable progress state. The kit owns this so
// git can be transport + history only: when two clones of the same session
// diverge, the sync layer reads both sides and calls mergeProgressStates rather
// than letting git textually merge the pretty-printed JSON (which would corrupt
// the envelope). This is the kit-local cousin of the web app's buildMergedState,
// adapted for an agent/CLI context: NO interactive conflict dialog, newest-wins
// by the timestamps the envelope actually carries, and every coarse tie-break is
// reported so the caller can tell the user where a side was dropped.
//
// LIMIT (documented, by design): the envelope has no per-field clock, only the
// whole-file writer.ts and the kit namespace updatedAt. So a field edited
// concurrently on both sides tie-breaks coarsely (newest file wins) and the
// dropped side is listed in `coarse`. Per-field clocks are deferred future work
// (they would need a PROGRESS_FORMAT bump mirrored into the web app).
//
// Pure: no fs, no node deps. Changes NO envelope format and does not bump
// PROGRESS_FORMAT, so the lossless web<->kit handoff is untouched.

import { KNOWN_STATE_KEYS, type ProgressState, type KitNamespace } from "./progress.ts";

export interface MergeResult {
  state: ProgressState;
  coarse: string[]; // fields whose conflict was resolved by a coarse tie-break
}

export interface MergeOpts {
  oursTs: number; // our file's writer.ts
  theirsTs: number; // their file's writer.ts
}

const ARTIFACT_KEYS = ["bizModel", "grill", "assets", "research", "swot", "prd", "naming", "brand", "governance"] as const;

const num = (v: unknown): number => (typeof v === "number" && !Number.isNaN(v) ? v : 0);
const genAt = (v: unknown): number =>
  v && typeof v === "object" ? num((v as Record<string, unknown>)["generatedAt"]) : 0;
const jsonEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Keys never copied from parsed/synced data via bracket assignment
// (prototype-pollution hardening for the sync-ingest path: a tampered or
// malicious session file could otherwise carry an "__proto__" key).
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Merge `ours` and `theirs` into one state. Tie-break direction: a strictly
// newer file wins; on an exact timestamp tie the incoming side (theirs) wins, so
// the result is deterministic regardless of which clone runs the merge.
export function mergeProgressStates(ours: ProgressState, theirs: ProgressState, opts: MergeOpts): MergeResult {
  const coarse: string[] = [];
  const oursNewer = opts.oursTs > opts.theirsTs; // strict; equal -> theirs

  // ---- answers: union by qId; differing values tie-break coarsely ----
  const answers: Record<string, unknown> = {};
  const oa = rec(ours.answers);
  const ta = rec(theirs.answers);
  for (const k of new Set([...Object.keys(oa), ...Object.keys(ta)])) {
    if (UNSAFE_KEYS.has(k)) continue;
    const inO = k in oa;
    const inT = k in ta;
    if (inO && !inT) answers[k] = oa[k];
    else if (!inO && inT) answers[k] = ta[k];
    else if (jsonEq(oa[k], ta[k])) answers[k] = oa[k];
    else {
      answers[k] = oursNewer ? oa[k] : ta[k];
      coarse.push(`answers.${k}`);
    }
  }

  // ---- feedback: union by qId; collision by round, then entry ts, then file ts ----
  const feedback: Record<string, unknown> = {};
  const of = rec(ours.feedback);
  const tf = rec(theirs.feedback);
  for (const k of new Set([...Object.keys(of), ...Object.keys(tf)])) {
    if (UNSAFE_KEYS.has(k)) continue;
    const o = of[k];
    const t = tf[k];
    if (o != null && t == null) feedback[k] = o;
    else if (o == null && t != null) feedback[k] = t;
    else if (jsonEq(o, t)) feedback[k] = o;
    else {
      const oR = num(rec(o)["round"]);
      const tR = num(rec(t)["round"]);
      const oTs = num(rec(o)["ts"]);
      const tTs = num(rec(t)["ts"]);
      const pickOurs = oR !== tR ? oR > tR : oTs !== tTs ? oTs > tTs : oursNewer;
      feedback[k] = pickOurs ? o : t;
      coarse.push(`feedback.${k}`);
    }
  }

  // ---- artifacts: non-null beats null; both differ -> newer generatedAt, else file ts ----
  const artifact = (key: (typeof ARTIFACT_KEYS)[number]): unknown => {
    const o = ours[key];
    const t = theirs[key];
    if (o == null && t == null) return null;
    if (o != null && t == null) return o;
    if (o == null && t != null) return t;
    if (jsonEq(o, t)) return o;
    const og = genAt(o);
    const tg = genAt(t);
    const pickOurs = og !== tg ? og > tg : oursNewer;
    coarse.push(key);
    return pickOurs ? o : t;
  };

  const merged: ProgressState = {
    version: 2,
    answers,
    feedback,
    bizModel: artifact("bizModel"),
    grill: artifact("grill"),
    assets: artifact("assets"),
    research: artifact("research"),
    swot: artifact("swot"),
    prd: artifact("prd"),
    naming: artifact("naming"),
    brand: artifact("brand"),
    governance: artifact("governance"),
    kit: mergeKit(ours.kit, theirs.kit, oursNewer),
  };

  // ---- unknown future keys: carried through, newer side wins ----
  // Apply the older side first, then the newer, so the newer value overwrites.
  for (const src of oursNewer ? [theirs, ours] : [ours, theirs]) {
    for (const k of Object.keys(src)) {
      if (!UNSAFE_KEYS.has(k) && !(KNOWN_STATE_KEYS as readonly string[]).includes(k)) merged[k] = (src as Record<string, unknown>)[k];
    }
  }

  return { state: merged, coarse: Array.from(new Set(coarse)).sort() };
}

// The kit namespace is agent-owned resume state. Union the additive parts
// (modulesRun, parked) and take the newer side for the singular ones (cursor),
// with updatedAt as the max of both clocks.
function mergeKit(o: KitNamespace | null, t: KitNamespace | null, oursNewer: boolean): KitNamespace | null {
  if (!o && !t) return null;
  if (o && !t) return o;
  if (!o && t) return t;
  const oo = o as KitNamespace;
  const tt = t as KitNamespace;

  const modulesRun = Array.from(new Set([...(oo.modulesRun || []), ...(tt.modulesRun || [])]));
  const parked: Record<string, string[]> = {};
  for (const src of [oo.parked || {}, tt.parked || {}]) {
    for (const [k, v] of Object.entries(src)) {
      if (UNSAFE_KEYS.has(k)) continue;
      parked[k] = Array.from(new Set([...(parked[k] || []), ...(Array.isArray(v) ? v : [])]));
    }
  }
  const newer = oursNewer ? oo : tt;
  const older = oursNewer ? tt : oo;
  const panelMeta = { ...(older.panelMeta || {}), ...(newer.panelMeta || {}) };

  const kit: KitNamespace = {
    schema: Math.max(num(oo.schema) || 1, num(tt.schema) || 1),
    updatedAt: Math.max(num(oo.updatedAt), num(tt.updatedAt)),
  };
  if (modulesRun.length) kit.modulesRun = modulesRun;
  if (Object.keys(parked).length) kit.parked = parked;
  const cursor = newer.cursor ?? older.cursor;
  if (cursor) kit.cursor = cursor;
  if (Object.keys(panelMeta).length) kit.panelMeta = panelMeta;
  return kit;
}
