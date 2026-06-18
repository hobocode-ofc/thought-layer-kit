// Node IO for the deterministic scaffold, shared by both frontends (the
// tl_scaffold Pi tool and the `tl scaffold` CLI). The pure generation lives in
// scaffold.ts; this loads the state file, writes the site to a publish dir, and
// writes the build.json manifest co-located with the selected state file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadStateFile } from "./state-file.ts";
import { extractScaffoldSpec, buildStarterSite, scaffoldManifest, type ScaffoldOptions } from "./scaffold.ts";
import type { StateOpResult } from "./state-ops.ts";

export interface ScaffoldRunOptions extends ScaffoldOptions {
  path?: string;
  outDir?: string;
}

export function runScaffold(opts: ScaffoldRunOptions, ctx: { builtAt: string }): StateOpResult {
  try {
    const loaded = loadStateFile(opts.path);
    const spec = extractScaffoldSpec(loaded.state);
    const { files } = buildStarterSite(spec, { domain: opts.domain, founderName: opts.founderName, socialImage: opts.socialImage });

    const outDir = opts.outDir || "dist";
    const outAbs = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
    mkdirSync(outAbs, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(outAbs, name), content);
    }

    const prd = loaded.state.prd && typeof loaded.state.prd === "object" ? (loaded.state.prd as Record<string, unknown>) : null;
    const grill = loaded.state.grill && typeof loaded.state.grill === "object" ? (loaded.state.grill as Record<string, unknown>) : null;
    const manifest = scaffoldManifest(outDir, ctx.builtAt, {
      stateFile: loaded.path,
      prdTs: prd && typeof prd["ts"] === "number" ? (prd["ts"] as number) : null,
      grillDone: !!(grill && grill["done"] === true),
      fromSpeedrun: loaded.state.kit?.cursor?.phase === "speedrun",
    });

    // build.json sits in the selected state file's .thought-layer/ dir.
    const manifestPath = join(dirname(loaded.path), "build.json");
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const names = Object.keys(files);
    return {
      ok: true,
      message:
        `Scaffolded a deployable static site for "${spec.brandName}" -> ${outAbs} ` +
        `(${names.length} files: ${names.join(", ")}). Manifest: ${manifestPath}. ` +
        `Deploy the publish dir, or build the full product with /tl-build.`,
      details: { publishDir: outDir, outAbs, files: names, manifestPath, brandName: spec.brandName, hadBrand: loaded.state.brand != null },
    };
  } catch (e) {
    return { ok: false, message: `tl_scaffold error: ${(e as Error).message}`, details: {} };
  }
}
