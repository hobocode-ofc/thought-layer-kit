// Regenerate core/stage-map.ts from the web app's generated stage-map.json.
// Run this after the web app's src/data/sections.js changes, so the kit never
// writes an answer to a question id the web app does not have. The drift test
// (core/stages.test.ts) fails if a mapped qId is no longer present here.
//
//   node scripts/sync-stage-map.mjs [path-to-stage-map.json]
//
// Default source is the sibling ThoughtLayer repo on a dev machine. The
// regenerated core/stage-map.ts is committed; this script is dev-only.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = resolve(root, process.argv[2] || "../ThoughtLayer/stage-map.json");

const map = JSON.parse(readFileSync(src, "utf8"));
const allIds = map.steps.map((s) => s.id);

const out = `// GENERATED from the web app's stage-map.json by scripts/sync-stage-map.mjs.
// Do not edit by hand. This is the vendored copy of the web app's question
// registry; it is the single source of truth for which question ids exist, so
// an agent never writes an answer the web app cannot represent. Regenerate with
// \`node scripts/sync-stage-map.mjs\` after the web app's sections.js changes.

export const STATE_FORMAT = ${map.stateFormat};

export const AREAS: readonly string[] = ${JSON.stringify(map.areas)};

// Every question id, in canonical order.
export const ALL_QIDS: readonly string[] = ${JSON.stringify(allIds)};

// Question ids that hold a value under answers[] (text / repeatable / parties /
// research-flagged text). Artifact and page steps are excluded.
export const ANSWERABLE_QIDS: readonly string[] = ${JSON.stringify(map.answerableIds)};
`;

writeFileSync(join(root, "core/stage-map.ts"), out);
console.log(`core/stage-map.ts: ${allIds.length} qids (${map.answerableIds.length} answerable) from ${src}`);
