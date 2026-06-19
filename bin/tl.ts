#!/usr/bin/env node
// The Thought Layer CLI: read and write the portable progress file
// (.thought-layer/state.json) from any shell-capable agent (Claude Code, a CI
// job, a plain terminal) - the same lossless interop file the web app and the
// Pi tl_state tool share. Hosts with the Pi extension use tl_state instead; this
// is the universal floor. It delegates to the exact same core dispatch
// (applyStateOp), so the model never hand-writes the JSON.
//
//   tl read [path]                       where the run stands (human summary)
//   tl read --json [path]                machine-readable details incl. full state
//   tl export [path]                     same as read (handoff check)
//   tl answer <qId> <value> [path]       record an answer
//   tl feedback --data '<json>'          record a panel verdict (json: {qId,mode,personas,endState,round})
//   tl artifact <key> --data '<json>'    store prd/grill/bizModel/naming/brand/etc. (json: the value object)
//   tl cursor --data '<json>'            save the resume position (json: the cursor object)
//   tl park <key> <note> [path]          stash a panel note with no web-app question
//   tl exec --data '<json>'              run a full {op,...} payload (mirrors the tl_state tool exactly)
//
//   --path <p>   project dir or .json path (default ./.thought-layer/state.json)
//   --data <j>   JSON payload; "-" reads it from stdin
//   --json       print details JSON instead of the human message
//   -h, --help

import { readFileSync } from "node:fs";
import { applyStateOp, type StateOp } from "../core/state-ops.ts";
import { runScaffold } from "../core/scaffold-io.ts";
import { runDeploy } from "../core/deploy-io.ts";
import { runSync } from "../core/sync-io.ts";
import { runArtifacts } from "../core/artifacts-io.ts";
import { runWiki } from "../core/notion-io.ts";

const HELP = `tl - read/write a portable Thought Layer state file (default: .thought-layer/state.json)

  tl read [path] [--json]            where the run stands
  tl list [dir]                      list the state files under .thought-layer/ (juggle several ideas)
  tl scaffold [--out dist] [--domain x.com] [--founder "Name"]  deterministic deployable static site from the spec + brand
  tl deploy [--dry-run] [--anonymous] [--name x] [--site id]  take build.json's publish dir live to a user-owned Netlify URL
            [--static-only] [--provision-db] [--apply-schema]   when build.json has a backend: ships functions+env by default; flags opt out or add Neon provision/schema
  tl sync <init|save|list|open|pull|push|status>             store/sync your session files in your own private GitHub repo
            [--repo owner/name] [--name x] [--dir p] [--workspace w] [--message m] [--no-push]
  tl artifacts [--name x] [--workspace w]                    deliver the full asset bundle (PRD, brand, infographics, landing, deploy rules) to your sessions repo
            [--no-push] [--no-deliver] [--domain x.com] [--founder "Name"]
  tl wiki [--parent-page id|url] [--name x]                  build/refresh a private Notion wiki from the session + delivered artifacts
            [--workspace w] [--replace] [--dry-run]            (set THOUGHT_LAYER_NOTION_TOKEN; share a Notion page with your integration)
  tl export [path]                   handoff check
  tl answer <qId> <value> [path]     record an answer
  tl feedback --data '<json>'        record a panel verdict ({qId,mode,personas,endState,round})
  tl artifact <key> --data '<json>'  store an artifact value object
  tl cursor --data '<json>'          save the resume cursor object
  tl park <key> <note> [path]        stash a panel note
  tl exec --data '<json>'            run a full {op,...} payload

Selecting a file: pass --path <file>.json (or a positional path) to any op, keep several
ideas as .thought-layer/<name>.json, or set THOUGHT_LAYER_STATE once as the session default.

  --path <p>  project dir or .json path   --data <j>  JSON payload ("-" = stdin)
  --json      print details JSON          -h, --help`;

function parseArgs(argv: string[]): { args: string[]; flags: Record<string, string | boolean> } {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") flags["help"] = true;
    else if (a === "--json") flags["json"] = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else args.push(a);
  }
  return { args, flags };
}

function readData(flags: Record<string, string | boolean>): unknown {
  const d = flags["data"];
  if (d === undefined) return undefined;
  const raw = d === "-" || d === true ? readFileSync(0, "utf8") : String(d);
  try { return JSON.parse(raw); }
  catch { throw new Error("--data is not valid JSON."); }
}

function buildOp(args: string[], flags: Record<string, string | boolean>): StateOp {
  const op = args[0];
  const path = typeof flags["path"] === "string" ? flags["path"] : undefined;
  const data = readData(flags) as Record<string, unknown> | undefined;
  switch (op) {
    case "read":
    case "export":
      return { op, path: path ?? args[1] };
    case "list":
      return { op, path: path ?? args[1] };
    case "answer":
      return { op, qId: args[1], value: args[2], path: path ?? args[3] };
    case "park":
      return { op, key: args[1], note: args[2], path: path ?? args[3] };
    case "feedback":
      return { op, path, ...(data || {}) } as StateOp;
    case "artifact":
      return { op, artifact: args[1], value: data, path };
    case "cursor":
      return { op, cursor: (data || {}) as StateOp["cursor"], path };
    case "exec":
      return { path, ...(data || {}) } as StateOp;
    default:
      throw new Error(`Unknown command "${op ?? ""}". Run \`tl --help\`.`);
  }
}

function main(): void {
  const { args, flags } = parseArgs(process.argv.slice(2));
  // `npx @hobocode/thought-layer tl <op>` makes npx run the package-named bin
  // and pass "tl" as the first ARG. Drop a leading bin-name token so every
  // invocation form (npx with or without `tl`, or a global `tl`) resolves the op.
  if (args[0] === "tl" || args[0] === "thought-layer") args.shift();
  if (flags["help"] || args.length === 0) { console.log(HELP); process.exit(0); }

  // scaffold is a distinct capability (generate a deployable site), not a state op.
  if (args[0] === "scaffold") {
    const r = runScaffold(
      {
        path: typeof flags["path"] === "string" ? flags["path"] : undefined,
        outDir: typeof flags["out"] === "string" ? flags["out"] : undefined,
        domain: typeof flags["domain"] === "string" ? flags["domain"] : undefined,
        founderName: typeof flags["founder"] === "string" ? flags["founder"] : undefined,
      },
      { builtAt: new Date().toISOString() },
    );
    if (flags["json"]) console.log(JSON.stringify(r.details, null, 2));
    else console.log(r.message);
    process.exit(r.ok ? 0 : 1);
  }

  // deploy takes the build output live; it is async (Netlify API / CLI), so it
  // resolves before exiting rather than returning synchronously like the ops.
  if (args[0] === "deploy") {
    runDeploy(
      {
        path: typeof flags["path"] === "string" ? flags["path"] : undefined,
        dryRun: flags["dry-run"] === true,
        anonymous: flags["anonymous"] === true,
        siteName: typeof flags["name"] === "string" ? flags["name"] : undefined,
        siteId: typeof flags["site"] === "string" ? flags["site"] : undefined,
        staticOnly: flags["static-only"] === true,
        provisionDb: flags["provision-db"] === true,
        applySchema: flags["apply-schema"] === true,
      },
      { deployedAt: new Date().toISOString() },
    ).then((r) => {
      if (flags["json"]) console.log(JSON.stringify(r.details, null, 2));
      else console.log(r.message);
      process.exit(r.ok ? 0 : 1);
    });
    return;
  }

  // sync stores/syncs session files in the user's own private GitHub repo; it is
  // async (git/gh), so it resolves before exiting, like deploy.
  if (args[0] === "sync") {
    runSync(
      {
        op: typeof args[1] === "string" ? args[1] : "status",
        name: typeof flags["name"] === "string" ? flags["name"] : undefined,
        repo: typeof flags["repo"] === "string" ? flags["repo"] : undefined,
        dir: typeof flags["dir"] === "string" ? flags["dir"] : undefined,
        workspace: typeof flags["workspace"] === "string" ? flags["workspace"] : undefined,
        message: typeof flags["message"] === "string" ? flags["message"] : undefined,
        noPush: flags["no-push"] === true,
        path: typeof flags["path"] === "string" ? flags["path"] : undefined,
      },
      { ts: Date.now(), exportedAt: new Date().toISOString() },
    ).then((r) => {
      if (flags["json"]) console.log(JSON.stringify(r.details, null, 2));
      else console.log(r.message);
      process.exit(r.ok ? 0 : 1);
    });
    return;
  }

  // artifacts generates the full deliverable bundle from a session and delivers
  // it to the user's own private sessions repo (it reuses the sync git plumbing).
  if (args[0] === "artifacts") {
    const r = runArtifacts(
      {
        path: typeof flags["path"] === "string" ? flags["path"] : undefined,
        name: typeof flags["name"] === "string" ? flags["name"] : undefined,
        workspace: typeof flags["workspace"] === "string" ? flags["workspace"] : undefined,
        dir: typeof flags["dir"] === "string" ? flags["dir"] : undefined,
        message: typeof flags["message"] === "string" ? flags["message"] : undefined,
        noPush: flags["no-push"] === true,
        noDeliver: flags["no-deliver"] === true,
        domain: typeof flags["domain"] === "string" ? flags["domain"] : undefined,
        founderName: typeof flags["founder"] === "string" ? flags["founder"] : undefined,
      },
      { generatedAt: new Date().toISOString() },
    );
    if (flags["json"]) console.log(JSON.stringify(r.details, null, 2));
    else console.log(r.message);
    process.exit(r.ok ? 0 : 1);
  }

  // wiki builds/refreshes a private Notion wiki from the session + the delivered
  // artifacts. Async (Notion REST), so it resolves before exiting like deploy.
  if (args[0] === "wiki") {
    runWiki({
      path: typeof flags["path"] === "string" ? flags["path"] : undefined,
      name: typeof flags["name"] === "string" ? flags["name"] : undefined,
      workspace: typeof flags["workspace"] === "string" ? flags["workspace"] : undefined,
      dir: typeof flags["dir"] === "string" ? flags["dir"] : undefined,
      parentPage: typeof flags["parent-page"] === "string" ? flags["parent-page"] : undefined,
      replace: flags["replace"] === true,
      dryRun: flags["dry-run"] === true,
    }).then((r) => {
      if (flags["json"]) console.log(JSON.stringify(r.details, null, 2));
      else console.log(r.message);
      process.exit(r.ok ? 0 : 1);
    });
    return;
  }

  let payload: StateOp;
  try { payload = buildOp(args, flags); }
  catch (e) { console.error((e as Error).message); process.exit(2); return; }

  const r = applyStateOp(payload, { ts: Date.now(), exportedAt: new Date().toISOString() });
  if (flags["json"]) console.log(JSON.stringify(r.details, null, 2));
  else console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}

main();
