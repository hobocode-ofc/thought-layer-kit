// The deterministic core of The Thought Layer: scoring, domain checks, and the
// numeric projection model. No model calls, no side effects beyond the domain
// fetch. This is the single source of truth the Pi tools and any other consumer
// share, so the math is exact and never re-derived by an LLM.
//
// Relative imports carry explicit .ts extensions so Pi's jiti loader and Vite
// resolve them without guesswork. This is a TypeScript-source package consumed
// by TS-aware tooling (Pi/jiti, Vite), not by a plain Node require.

export * from "./scoring.ts";
export * from "./domains.ts";
export * from "./model.ts";
export * from "./progress.ts";
export * from "./stages.ts";
export * from "./stage-map.ts";
export * from "./state-file.ts";
export * from "./state-ops.ts";
export * from "./merge.ts";
export * from "./sync.ts";
export * from "./sync-io.ts";
export * from "./backend.ts";
export * from "./backend-io.ts";
export * from "./scaffold.ts";
export * from "./scaffold-io.ts";
export * from "./artifacts.ts";
export * from "./artifacts-io.ts";
export * from "./notion.ts";
export * from "./notion-io.ts";
export * from "./deploy.ts";
export * from "./deploy-io.ts";
