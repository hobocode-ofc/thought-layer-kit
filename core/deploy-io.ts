// Node IO for the deploy step, shared by the deploy Pi tool and the `tl deploy`
// CLI. The pure transforms live in deploy.ts; this reads build.json, walks the
// publish dir, talks to the Netlify API (BYO token, file-digest method), or
// delegates the zero-account path to the Netlify CLI's own --allow-anonymous
// flow, then writes a deploy.json record.
//
// Two deploy models, both keeping ownership with the user and nothing phoning a
// central account (the kit has no server):
//   token     - deploy into the user's OWN Netlify account via NETLIFY_AUTH_TOKEN.
//               The site is theirs from the first second. This is the primary,
//               fully-in-process path (sha1 + fetch, no zip, no deps).
//   anonymous - the user has no account yet: shell out to `netlify deploy
//               --allow-anonymous` (Netlify's own supported flow) for a live URL
//               plus a one-hour claim link. We never reverse-engineer that
//               handshake; we use the vendor tool when it is installed.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { resolveStatePath } from "./state-file.ts";
import type { BuildManifest } from "./scaffold.ts";
import type { StateOpResult } from "./state-ops.ts";
import {
  buildFileDigests, uploadPath, sanitizeSiteName, parseCliDeployOutput, deployRecord,
  type FileMap, type DeployRecord,
} from "./deploy.ts";
import { normalizeBackendMeta, planEnvVars, type BackendMeta } from "./backend.ts";
import {
  pushEnvVarsApi, cliImportEnv, resolveDbUrl, provisionNeon, applySchema, type EnvPushResult,
} from "./backend-io.ts";

const NETLIFY_API = "https://api.netlify.com/api/v1";

export interface DeployRunOptions {
  path?: string;       // state file / project dir, selects which build.json to read
  dryRun?: boolean;    // plan only: walk + digest, no network or spawn
  anonymous?: boolean; // force the no-account CLI path even if a token is set
  siteName?: string;   // create the site under this name (else Netlify auto-names)
  siteId?: string;     // deploy to an existing site (re-deploy) instead of creating one
  staticOnly?: boolean;   // ship only the front end even when build.json has a backend
  provisionDb?: boolean;  // opt in: provision Neon with the user's own NEON_API_KEY
  applySchema?: boolean;  // opt in: apply schema.sql with psql after the DB is reachable
}

// ---- locate + read the build manifest ----------------------------------------

interface ResolvedBuild {
  manifest: BuildManifest;
  manifestPath: string;
  publishDirAbs: string;
  stateFile: string;
}

function readBuild(target?: string): ResolvedBuild {
  const statePath = resolveStatePath(target);
  const manifestPath = join(dirname(statePath), "build.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No build.json found at ${manifestPath}. Run the build first: the thought-layer-build skill (/tl-build) ` +
        `or the tl_scaffold tool (\`tl scaffold\`) writes the manifest the deploy reads.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BuildManifest;
  // publishDir is relative to the project root (the parent of .thought-layer/),
  // falling back to cwd; absolute wins as-is.
  const projectRoot = dirname(dirname(statePath));
  const publishDirAbs = resolvePublishDir(manifest.publishDir, projectRoot);
  return { manifest, manifestPath, publishDirAbs, stateFile: statePath };
}

function resolvePublishDir(publishDir: string, projectRoot: string): string {
  const candidates = [resolve(projectRoot, publishDir), resolve(process.cwd(), publishDir)];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    `Publish dir "${publishDir}" from build.json does not exist (looked in ${candidates.join(" and ")}). ` +
      `Re-run the build, or fix publishDir in build.json.`,
  );
}

// ---- walk the publish dir into an in-memory file map --------------------------

function walkPublishDir(dir: string): FileMap {
  const files: FileMap = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        const rel = relative(dir, full).split(/[\\/]/).join("/");
        files["/" + rel] = readFileSync(full);
      }
    }
  };
  walk(dir);
  return files;
}

// ---- the Netlify file-digest deploy (BYO token) ------------------------------

interface DigestResult {
  url: string;
  adminUrl: string;
  siteId: string;
  deployId: string;
  uploaded: number;
  state: string;
}

async function netlifyJson(url: string, init: RequestInit, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Netlify API ${res.status} ${res.statusText} on ${init.method || "GET"} ${url}: ${body.slice(0, 400)}`);
  }
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

async function digestDeploy(
  files: FileMap,
  opts: { token: string; siteName?: string; siteId?: string },
): Promise<DigestResult> {
  let siteId = opts.siteId;
  let adminUrl = "";
  let siteUrl = "";

  if (!siteId) {
    const body = opts.siteName ? JSON.stringify({ name: sanitizeSiteName(opts.siteName) }) : JSON.stringify({});
    const site = await netlifyJson(`${NETLIFY_API}/sites`, { method: "POST", headers: { "Content-Type": "application/json" }, body }, opts.token);
    siteId = String(site["id"] || "");
    adminUrl = String(site["admin_url"] || "");
    siteUrl = String(site["ssl_url"] || site["url"] || "");
  }

  const { digests, pathForDigest } = buildFileDigests(files);
  const deploy = await netlifyJson(
    `${NETLIFY_API}/sites/${siteId}/deploys`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: digests }) },
    opts.token,
  );
  const deployId = String(deploy["id"] || "");
  const required = Array.isArray(deploy["required"]) ? (deploy["required"] as string[]) : [];
  if (!adminUrl) adminUrl = String(deploy["admin_url"] || "");

  // Upload one file per unique required sha1.
  let uploaded = 0;
  for (const sha of required) {
    const key = pathForDigest[sha];
    const buf = key ? files[key] : undefined;
    if (!key || !buf) continue; // Netlify asked for a digest we did not send; skip.
    const r = await fetch(`${NETLIFY_API}/deploys/${deployId}/files/${uploadPath(key)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(buf), // Buffer is a Uint8Array; this satisfies BodyInit cleanly.
    });
    if (!r.ok) throw new Error(`Netlify upload ${r.status} for ${key}: ${(await r.text()).slice(0, 200)}`);
    uploaded++;
  }

  // Poll until the deploy is live (small static sites are usually instant).
  let state = String(deploy["state"] || "");
  for (let i = 0; i < 30 && state !== "ready" && state !== "error"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const d = await netlifyJson(`${NETLIFY_API}/deploys/${deployId}`, { method: "GET" }, opts.token);
    state = String(d["state"] || "");
    if (!siteUrl) siteUrl = String(d["ssl_url"] || d["deploy_ssl_url"] || "");
  }
  if (state === "error") throw new Error(`Netlify deploy ${deployId} reported state "error".`);

  return { url: siteUrl, adminUrl, siteId: String(siteId), deployId, uploaded, state: state || "uploaded" };
}

// ---- the no-env-token path: delegate to the Netlify CLI ----------------------

export function hasNetlifyCli(): boolean {
  try {
    const r = spawnSync("netlify", ["--version"], { encoding: "utf8", timeout: 15000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

// --allow-anonymous shipped in the Netlify CLI in 2026-03; older CLIs reject it.
// Probe `netlify deploy --help` so we guide instead of spawning a deploy that
// errors on the unknown flag (and would otherwise prompt interactively).
export function cliSupportsAnonymous(): boolean {
  try {
    const r = spawnSync("netlify", ["deploy", "--help"], { encoding: "utf8", timeout: 15000 });
    return `${r.stdout || ""}${r.stderr || ""}`.includes("--allow-anonymous");
  } catch {
    return false;
  }
}

// Is the CLI logged in via its OWN stored config (independent of our env)? This
// matters because --allow-anonymous is a no-op when logged in, and a plain
// deploy then needs a target site - so a logged-in CLI must create a site in the
// user's account instead. getCurrentUser exits 0 with JSON when logged in.
export function cliLoggedIn(): boolean {
  try {
    const r = spawnSync("netlify", ["api", "getCurrentUser", "--data", "{}"], { encoding: "utf8", timeout: 20000 });
    return r.status === 0 && (r.stdout || "").trim().startsWith("{");
  } catch {
    return false;
  }
}

export interface CliDeployResult {
  url: string | null;
  claimUrl: string | null;
  owned: boolean;
  siteName: string | null;
  raw: string;
}

// Deploy via the Netlify CLI, picking flags from the CLI's own login state:
//   logged in  -> create (or, with siteId, reuse) a site in the user's account,
//                 owned immediately, no claim step.
//   logged out -> an anonymous, claimable site (one-hour window).
// --no-build forces a plain publish of our already-built static dir (no
// framework detection / build step). The caller has decided the CLI path is
// wanted and that the CLI exists + supports what is needed.
function cliDeploy(publishDirAbs: string, opts: { siteName?: string; siteId?: string }, loggedIn: boolean): CliDeployResult {
  const base = ["deploy", "--dir", publishDirAbs, "--prod", "--no-build"];
  let args: string[];
  let siteName: string | null = null;
  if (loggedIn) {
    if (opts.siteId) args = [...base, "--site", opts.siteId];
    else {
      siteName = sanitizeSiteName(opts.siteName || "") || `thought-layer-${randomBytes(4).toString("hex")}`;
      args = [...base, "--create-site", siteName];
    }
  } else {
    args = [...base, "--allow-anonymous"];
  }
  const r = spawnSync("netlify", args, { encoding: "utf8", timeout: 180000 });
  const raw = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  if (r.status !== 0) {
    throw new Error(`netlify ${args.join(" ")} failed (exit ${r.status}). Output:\n${raw.slice(0, 800)}`);
  }
  const parsed = parseCliDeployOutput(raw);
  // A claim link only applies to the anonymous (logged-out) site.
  return { url: parsed.url, claimUrl: loggedIn ? null : parsed.claimUrl, owned: loggedIn, siteName, raw };
}

// ---- backend deploy helpers (functions ship via the user's Netlify CLI) ------

// Resolve the functions dir from build.json (relative to the project root, then
// cwd). Returns null when it is not on disk so the caller can ship the front end
// only and say so, rather than failing.
function resolveFunctionsDir(functionsDir: string, projectRoot: string): string | null {
  const candidates = [resolve(projectRoot, functionsDir), resolve(process.cwd(), functionsDir)];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

// Count the top-level function entries (each file or directory is one function),
// for the dry-run plan only.
function countFunctionFiles(dir: string): number {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith(".")).length;
  } catch {
    return 0;
  }
}

// Create a site in the user's own account via the API (token path).
async function createSiteApi(token: string, name?: string): Promise<{ id: string; slug: string; adminUrl: string; url: string }> {
  const body = name ? JSON.stringify({ name: sanitizeSiteName(name) }) : JSON.stringify({});
  const site = await netlifyJson(`${NETLIFY_API}/sites`, { method: "POST", headers: { "Content-Type": "application/json" }, body }, token);
  return {
    id: String(site["id"] || ""),
    slug: String(site["account_slug"] || site["account_id"] || ""),
    adminUrl: String(site["admin_url"] || ""),
    url: String(site["ssl_url"] || site["url"] || ""),
  };
}

// Create a site via the Netlify CLI's own stored auth (no-token path), so the
// site id is known before env import and deploy.
function createSiteCli(name?: string): { id: string } {
  const payload = JSON.stringify(name ? { name: sanitizeSiteName(name) } : {});
  const r = spawnSync("netlify", ["api", "createSite", "--data", payload], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) {
    throw new Error(`netlify api createSite failed (exit ${r.status}): ${(r.stderr || r.stdout || "").slice(0, 300)}`);
  }
  let id = "";
  try { id = String((JSON.parse(r.stdout || "{}") as Record<string, unknown>)["id"] || ""); } catch { /* unparseable */ }
  if (!id) throw new Error("could not parse the new site id from the Netlify CLI");
  return { id };
}

// Deploy the static dir plus the functions in one CLI invocation, targeting a
// known site id. Drives functions explicitly with --functions (independent of
// netlify.toml). --no-build keeps the CLI from re-running a framework build of
// the already built static dir. NOTE (live-verify gate): if a real run shows
// --no-build suppresses function bundling, drop it for backend deploys.
function cliDeployWithFunctions(
  publishDirAbs: string,
  functionsDirAbs: string | null,
  siteId: string,
  token: string,
): { url: string | null; raw: string } {
  const args = [
    "deploy", "--prod", "--dir", publishDirAbs, "--no-build",
    ...(functionsDirAbs ? ["--functions", functionsDirAbs] : []),
    "--site", siteId,
  ];
  const childEnv = token ? { ...process.env, NETLIFY_AUTH_TOKEN: token } : process.env;
  const r = spawnSync("netlify", args, { encoding: "utf8", timeout: 300000, env: childEnv });
  const raw = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  if (r.status !== 0) {
    throw new Error(`netlify ${args.join(" ")} failed (exit ${r.status}). Output:\n${raw.slice(0, 800)}`);
  }
  return { url: parseCliDeployOutput(raw).url, raw };
}

// ---- the orchestrator (mirrors runScaffold's result shape) -------------------

export async function runDeploy(opts: DeployRunOptions, ctx: { deployedAt: string }): Promise<StateOpResult> {
  let build: ResolvedBuild;
  try {
    build = readBuild(opts.path);
  } catch (e) {
    return { ok: false, message: (e as Error).message, details: {} };
  }
  const { manifest, publishDirAbs, stateFile } = build;
  const files = walkPublishDir(publishDirAbs);
  const fileCount = Object.keys(files).length;
  if (fileCount === 0) {
    return { ok: false, message: `Publish dir ${publishDirAbs} is empty - nothing to deploy.`, details: {} };
  }

  // build.json may predate the backend block, so normalize defensively.
  const backend = normalizeBackendMeta(manifest.backend);
  // Ship the backend automatically when the build declares a serverless one,
  // unless the caller forced a static-only deploy. Static deploys with no
  // backend are byte-for-byte unchanged (backend is null, shipBackend false).
  const shipBackend = manifest.hasBackend && backend?.backendKind === "serverless" && !opts.staticOnly;

  // The note shown only when there is a backend that this deploy will NOT ship
  // (static-only by request, or a non-serverless backend we cannot automate).
  const backendWarn = manifest.hasBackend && !shipBackend
    ? (() => {
        const guide = backend?.guide || "BACKEND.md";
        const dbEnv = backend?.database?.envVar || "DATABASE_URL";
        const names = (backend?.envVars || []).map((v) => v.name).filter(Boolean);
        const others = names.filter((n) => n !== dbEnv);
        const envList = others.length ? `${dbEnv} plus ${others.join(", ")}` : dbEnv;
        const lead = opts.staticOnly
          ? `\n\nStatic only: the front end is live, the backend was not shipped (you passed --static-only). Re-run without it to ship the backend.`
          : `\n\nStatic deploy: the front end is live. This build also declares a backend that this deploy cannot ship automatically.`;
        return (
          `${lead} To run the backend, follow ${guide}: provision Neon Postgres, set ${envList} in your host environment, ` +
          `then run netlify deploy with the functions present.`
        );
      })()
    : "";

  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN || "";

  const writeRecord = (rec: DeployRecord): string => {
    const recPath = join(dirname(stateFile), "deploy.json");
    mkdirSync(dirname(recPath), { recursive: true });
    writeFileSync(recPath, JSON.stringify(rec, null, 2) + "\n");
    return recPath;
  };

  // --- dry run: plan only, no network, no spawn ---
  if (opts.dryRun) {
    const { digests } = buildFileDigests(files);
    let backendPlanMsg = backendWarn;
    let backendPlan: Record<string, unknown> | null = null;
    if (shipBackend && backend) {
      // Names + counts only; never read or print an env value.
      const fnDir = resolveFunctionsDir(backend.functionsDir, dirname(dirname(stateFile)));
      const fnCount = fnDir ? countFunctionFiles(fnDir) : 0;
      const plan = planEnvVars(backend);
      const names = plan.map((p) => p.name);
      const missing = names.filter((n) => !(typeof process.env[n] === "string" && process.env[n] !== ""));
      const db = resolveDbUrl(process.env);
      const path = token ? "Netlify CLI for functions plus the token API for env" : "Netlify CLI (logged in) for functions and env import";
      backendPlanMsg =
        `\n\nBackend plan: ship ${fnCount} function${fnCount === 1 ? "" : "s"} from ${backend.functionsDir} via the ${path}. ` +
        `Env var names (${names.length}): ${names.join(", ") || "none"}.` +
        `${missing.length ? ` Missing from this environment: ${missing.join(", ")}.` : ""}` +
        `${db.name ? ` Database url from ${db.name}.` : " No database url found (set DATABASE_URL, or use --provision-db)."}` +
        `${opts.provisionDb ? " Would provision Neon (--provision-db)." : ""}` +
        `${opts.applySchema ? " Would apply schema.sql (--apply-schema)." : ""}`;
      backendPlan = { functionsDir: backend.functionsDir, functionCount: fnCount, envVarNames: names, envVarsMissing: missing, dbUrlFrom: db.name, provisionDb: !!opts.provisionDb, applySchema: !!opts.applySchema };
    }
    return {
      ok: true,
      message:
        `Dry run: would deploy ${fileCount} files from ${publishDirAbs} (entry ${manifest.entry}) to Netlify ` +
        `via the ${token && !opts.anonymous ? "BYO-token digest" : "Netlify CLI (logged in -> a site in your account; logged out -> an anonymous claimable site)"} path.${backendPlanMsg}`,
      details: { dryRun: true, publishDir: publishDirAbs, entry: manifest.entry, fileCount, files: Object.keys(digests), hasBackend: manifest.hasBackend, shipBackend, backendPlan },
    };
  }

  // --- backend deploy: ship functions + env into the user's own account ---
  if (shipBackend && backend) {
    return runBackendDeploy(
      { manifest, backend, publishDirAbs, stateFile, fileCount, files },
      opts,
      ctx,
      { token, writeRecord },
    );
  }

  // --- CLI path: explicit (--anonymous), or the fallback when no env token ---
  const wantCli = opts.anonymous || !token;
  if (wantCli) {
    // The three honest ways to go live, shown whenever the CLI path cannot run.
    const guide = (lead: string, needs: string): StateOpResult => ({
      ok: false,
      message:
        lead +
        `To go live, choose one:\n` +
        `  1. BYO token (deploys into your own account, owned immediately): set NETLIFY_AUTH_TOKEN and re-run.\n` +
        `  2. Netlify CLI (\`npm i -g netlify-cli@latest\`) then re-run - logged in it creates a site in your account; logged out it deploys anonymously with a one-hour claim link.\n` +
        `  3. Manual: drag ${publishDirAbs} onto https://app.netlify.com/drop.`,
      details: { publishDir: publishDirAbs, needs },
    });
    if (!hasNetlifyCli()) {
      return guide(
        opts.anonymous
          ? "A CLI deploy needs the Netlify CLI, which is not installed. "
          : "No NETLIFY_AUTH_TOKEN is set and the Netlify CLI is not installed. ",
        "token-or-cli",
      );
    }
    const loggedIn = cliLoggedIn();
    if (!loggedIn && !cliSupportsAnonymous()) {
      return guide(
        "You are not logged into the Netlify CLI and it is too old for --allow-anonymous (that shipped 2026-03). ",
        "newer-cli-or-login-or-token",
      );
    }
    try {
      const { url, claimUrl, owned, siteName, raw } = cliDeploy(publishDirAbs, { siteName: opts.siteName, siteId: opts.siteId }, loggedIn);
      const recPath = writeRecord(
        deployRecord({
          deployedAt: ctx.deployedAt, mode: owned ? "cli" : "anonymous", publishDir: manifest.publishDir, fileCount,
          url, adminUrl: null, claimUrl, siteId: null, deployId: null,
          hasBackend: manifest.hasBackend, backendNote: manifest.backendNote, backendKind: backend?.backendKind ?? null,
          buildProducer: manifest.producer, stateFile,
        }),
      );
      // If anonymity was explicitly asked for but the CLI is logged in, it went
      // to the account instead - say so rather than implying it was anonymous.
      const anonNote = opts.anonymous && owned
        ? `\n(Note: you asked for an anonymous deploy, but the Netlify CLI is logged in, so this went to your account. Run \`netlify logout\` first for a truly anonymous, claimable deploy.)`
        : "";
      return {
        ok: true,
        message: owned
          ? `Deployed to your Netlify account via the CLI${siteName ? ` (new site ${siteName})` : ""}.${url ? ` Live: ${url}` : ""}` +
            `\nIt is owned by your account - no claim needed.\nRecorded ${recPath}.${anonNote}${backendWarn}` +
            (!url ? `\n(Could not parse a URL from the CLI output - see details.raw.)` : "")
          : `Deployed anonymously.${url ? ` Live: ${url}` : ""}${claimUrl ? `\nClaim it within 1 hour (transfers ownership to your account): ${claimUrl}` : ""}` +
            `\nRecorded ${recPath}.${backendWarn}` +
            (!url || !claimUrl ? `\n(Could not parse a URL/claim link from the CLI output - see details.raw.)` : ""),
        details: { mode: owned ? "cli" : "anonymous", url, claimUrl, owned, siteName, fileCount, raw },
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message, details: { mode: "cli" } };
    }
  }

  // --- BYO-token path: deploy into the user's own account ---
  try {
    const r = await digestDeploy(files, { token, siteName: opts.siteName, siteId: opts.siteId });
    const recPath = writeRecord(
      deployRecord({
        deployedAt: ctx.deployedAt, mode: "token", publishDir: manifest.publishDir, fileCount,
        url: r.url || null, adminUrl: r.adminUrl || null, claimUrl: null, siteId: r.siteId, deployId: r.deployId,
        hasBackend: manifest.hasBackend, backendNote: manifest.backendNote, backendKind: backend?.backendKind ?? null,
        buildProducer: manifest.producer, stateFile,
      }),
    );
    return {
      ok: true,
      message:
        `Deployed to your Netlify account (${r.uploaded} file${r.uploaded === 1 ? "" : "s"} uploaded, state ${r.state}).` +
        `${r.url ? ` Live: ${r.url}` : ""}${r.adminUrl ? `\nManage: ${r.adminUrl}` : ""}` +
        `\nIt is owned by your account - no claim needed. Re-deploy to the same site with --site ${r.siteId}.` +
        `\nRecorded ${recPath}.${backendWarn}`,
      details: { mode: "token", url: r.url, adminUrl: r.adminUrl, siteId: r.siteId, deployId: r.deployId, uploaded: r.uploaded, state: r.state },
    };
  } catch (e) {
    return { ok: false, message: `Deploy failed: ${(e as Error).message}`, details: { mode: "token" } };
  }
}

// Ship the backend (functions + env vars) into the user's own account. Functions
// are bundled and shipped by the user's Netlify CLI (the digest API cannot bundle
// TypeScript), so this forces the CLI deploy mechanism even when a token is set;
// the token, when present, is used for the secret-capable env API and to authorize
// the CLI non-interactively (owned, no claim). Env var VALUES are read only from
// process.env inside the backend-io helpers and are never recorded or printed.
async function runBackendDeploy(
  build: { manifest: BuildManifest; backend: BackendMeta; publishDirAbs: string; stateFile: string; fileCount: number; files: FileMap },
  opts: DeployRunOptions,
  ctx: { deployedAt: string },
  io: { token: string; writeRecord: (rec: DeployRecord) => string },
): Promise<StateOpResult> {
  const { manifest, backend, publishDirAbs, stateFile, fileCount, files } = build;
  const { token, writeRecord } = io;
  const projectRoot = dirname(dirname(stateFile));
  const plan = planEnvVars(backend);
  const guide = backend.guide || "BACKEND.md";
  const notes: string[] = [];

  // Opt in: provision Neon with the user's own key, so the DB url is known.
  let dbUrl = resolveDbUrl(process.env).value;
  let dbProvisioned = false;
  if (opts.provisionDb) {
    const pr = await provisionNeon(process.env);
    notes.push(pr.note);
    if (pr.provisioned && pr.url) { dbUrl = pr.url; dbProvisioned = true; }
  }

  const functionsDirAbs = resolveFunctionsDir(backend.functionsDir, projectRoot);

  // No CLI means functions cannot be bundled. Do not half-deploy: with a token,
  // still take the front end live and push env via the API; without one, stop
  // and guide. functionsShipped stays false either way.
  if (!hasNetlifyCli()) {
    if (!token) {
      return {
        ok: false,
        message:
          `This build has a backend, which needs the Netlify CLI to bundle and ship the functions, and the CLI is not installed. ` +
          `Install it (npm i -g netlify-cli@latest) and re-run, or set NETLIFY_AUTH_TOKEN to at least take the front end live, or follow ${guide}.`,
        details: { backendMode: "static-only-fallback", functionsShipped: false, needs: "netlify-cli" },
      };
    }
    try {
      const r = await digestDeploy(files, { token, siteName: opts.siteName, siteId: opts.siteId });
      let env: EnvPushResult | null = null;
      try { env = await pushEnvVarsApi(r.siteId, token, plan, process.env); }
      catch (e) { notes.push(`env push failed: ${(e as Error).message}`); }
      const recPath = writeRecord(deployRecord({
        deployedAt: ctx.deployedAt, mode: "token", publishDir: manifest.publishDir, fileCount,
        url: r.url || null, adminUrl: r.adminUrl || null, claimUrl: null, siteId: r.siteId, deployId: r.deployId,
        hasBackend: true, backendNote: manifest.backendNote, backendKind: backend.backendKind,
        backendMode: "static-only-fallback", functionsShipped: false, functionsDir: backend.functionsDir,
        envVarsSet: env?.set ?? [], envVarsMissing: env?.missing ?? plan.map((p) => p.name),
        dbProvisioned, schemaApplied: false, buildProducer: manifest.producer, stateFile,
      }));
      return {
        ok: true,
        message:
          `Deployed the static front end to your Netlify account${r.url ? ` (live: ${r.url})` : ""}. ` +
          `The functions were NOT shipped: the Netlify CLI bundles them and it is not installed. ` +
          `Install it (npm i -g netlify-cli@latest) and re-run to ship the backend, or follow ${guide}.` +
          (env?.set.length ? `\nSet env var names: ${env.set.join(", ")}.` : "") +
          (env?.missing.length ? `\nDeclared but missing from this environment: ${env.missing.join(", ")}.` : "") +
          `\nRecorded ${recPath}.${notes.length ? `\n${notes.join("\n")}` : ""}`,
        details: { mode: "token", backendMode: "static-only-fallback", functionsShipped: false, url: r.url, siteId: r.siteId, envVarsSet: env?.set, envVarsMissing: env?.missing },
      };
    } catch (e) {
      return { ok: false, message: `Static front end deploy failed: ${(e as Error).message}`, details: { backendMode: "static-only-fallback" } };
    }
  }

  if (!functionsDirAbs) {
    notes.push(`functions dir "${backend.functionsDir}" was not found on disk; shipping the front end only`);
  }

  // Resolve or create the target site so env can be set against a known id.
  let siteId = opts.siteId || "";
  let accountSlug: string | undefined;
  try {
    if (!siteId) {
      if (token) { const s = await createSiteApi(token, opts.siteName); siteId = s.id; accountSlug = s.slug; }
      else { siteId = createSiteCli(opts.siteName).id; }
    }
  } catch (e) {
    return { ok: false, message: `Could not create the Netlify site for the backend deploy: ${(e as Error).message}`, details: {} };
  }

  // Push env vars (API when a token is present, else CLI import).
  let env: EnvPushResult;
  try {
    env = token
      ? await pushEnvVarsApi(siteId, token, plan, process.env, accountSlug)
      : cliImportEnv(plan, process.env, siteId);
  } catch (e) {
    env = { method: token ? "api" : "cli", set: [], missing: plan.map((p) => p.name), note: `env push failed: ${(e as Error).message}` };
    notes.push(env.note);
  }

  // Opt in: apply schema.sql now that the database url is known.
  let schemaApplied = false;
  if (opts.applySchema) {
    const schemaPath = resolve(projectRoot, backend.database?.schemaFile || "schema.sql");
    const sr = applySchema(schemaPath, dbUrl, process.env);
    schemaApplied = sr.applied;
    notes.push(sr.note);
  }

  // Deploy the static dir plus the functions in one CLI invocation.
  let url: string | null = null;
  try {
    const d = cliDeployWithFunctions(publishDirAbs, functionsDirAbs, siteId, token);
    url = d.url;
  } catch (e) {
    return { ok: false, message: `Backend deploy failed: ${(e as Error).message}${notes.length ? `\n${notes.join("\n")}` : ""}`, details: { siteId, envVarsSet: env.set } };
  }
  const functionsShipped = !!functionsDirAbs;

  const recPath = writeRecord(deployRecord({
    deployedAt: ctx.deployedAt, mode: "cli", publishDir: manifest.publishDir, fileCount,
    url, adminUrl: null, claimUrl: null, siteId, deployId: null,
    hasBackend: true, backendNote: manifest.backendNote, backendKind: backend.backendKind,
    backendMode: "cli", functionsShipped, functionsDir: backend.functionsDir,
    envVarsSet: env.set, envVarsMissing: env.missing, dbProvisioned, schemaApplied,
    buildProducer: manifest.producer, stateFile,
  }));
  return {
    ok: true,
    message:
      `Deployed your backend to your Netlify account via the CLI${url ? ` (live: ${url})` : ""}. ` +
      `${functionsShipped ? `Functions shipped from ${backend.functionsDir}.` : `No functions were found on disk (${backend.functionsDir}); front end only.`} ` +
      `It is owned by your account, no claim needed. Re-deploy to the same site with --site ${siteId}.` +
      (env.set.length ? `\nSet env var names (${env.method}): ${env.set.join(", ")}.` : "") +
      (env.missing.length ? `\nDeclared but missing from this environment (set them, then re-run): ${env.missing.join(", ")}.` : "") +
      `\nRecorded ${recPath}.${notes.length ? `\n${notes.join("\n")}` : ""}` +
      (!url ? `\n(Could not parse a live URL from the CLI output; re-run to confirm.)` : ""),
    details: { mode: "cli", backendMode: "cli", url, siteId, functionsShipped, functionsDir: backend.functionsDir, envVarsSet: env.set, envVarsMissing: env.missing, dbProvisioned, schemaApplied },
  };
}
