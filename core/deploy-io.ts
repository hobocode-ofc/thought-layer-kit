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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { resolveStatePath } from "./state-file.ts";
import type { BuildManifest } from "./scaffold.ts";
import type { StateOpResult } from "./state-ops.ts";
import {
  buildFileDigests, uploadPath, sanitizeSiteName, parseAnonymousOutput, deployRecord,
  type FileMap, type DeployRecord,
} from "./deploy.ts";

const NETLIFY_API = "https://api.netlify.com/api/v1";

export interface DeployRunOptions {
  path?: string;       // state file / project dir, selects which build.json to read
  dryRun?: boolean;    // plan only: walk + digest, no network or spawn
  anonymous?: boolean; // force the no-account CLI path even if a token is set
  siteName?: string;   // create the site under this name (else Netlify auto-names)
  siteId?: string;     // deploy to an existing site (re-deploy) instead of creating one
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

// ---- the anonymous path: delegate to the Netlify CLI -------------------------

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

function anonymousDeploy(publishDirAbs: string): { url: string | null; claimUrl: string | null; raw: string } {
  const r = spawnSync(
    "netlify",
    ["deploy", "--dir", publishDirAbs, "--prod", "--allow-anonymous"],
    { encoding: "utf8", timeout: 180000 },
  );
  const raw = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  if (r.status !== 0) {
    throw new Error(`netlify deploy --allow-anonymous failed (exit ${r.status}). Output:\n${raw.slice(0, 800)}`);
  }
  return { ...parseAnonymousOutput(raw), raw };
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

  const backendWarn = manifest.hasBackend
    ? ` WARNING: build.json says hasBackend:true${manifest.backendNote ? ` (${manifest.backendNote})` : ""}; ` +
      `this static deploy publishes only the front end - the server part needs serverless functions or a separate host.`
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
    return {
      ok: true,
      message:
        `Dry run: would deploy ${fileCount} files from ${publishDirAbs} (entry ${manifest.entry}) to Netlify ` +
        `via the ${opts.anonymous ? "anonymous CLI" : token ? "BYO-token digest" : "(no token set - would use the anonymous CLI or guide you)"} path.${backendWarn}`,
      details: { dryRun: true, publishDir: publishDirAbs, entry: manifest.entry, fileCount, files: Object.keys(digests), hasBackend: manifest.hasBackend },
    };
  }

  // --- anonymous path: explicit, or the fallback when no token is set ---
  const wantAnonymous = opts.anonymous || !token;
  if (wantAnonymous) {
    // The three honest ways to go live, shown whenever we cannot run anonymous.
    const guide = (lead: string, needs: string): StateOpResult => ({
      ok: false,
      message:
        lead +
        `To go live, choose one:\n` +
        `  1. BYO token (deploys into your own account, owned immediately): set NETLIFY_AUTH_TOKEN and re-run.\n` +
        `  2. No account: a current Netlify CLI (\`npm i -g netlify-cli@latest\`) then re-run - uses netlify deploy --allow-anonymous for a 1-hour claimable URL.\n` +
        `  3. Manual: drag ${publishDirAbs} onto https://app.netlify.com/drop.`,
      details: { publishDir: publishDirAbs, needs },
    });
    if (!hasNetlifyCli()) {
      return guide(
        opts.anonymous
          ? "Anonymous deploy needs the Netlify CLI, which is not installed. "
          : "No NETLIFY_AUTH_TOKEN is set and the Netlify CLI is not installed. ",
        "token-or-cli",
      );
    }
    if (!cliSupportsAnonymous()) {
      return guide(
        "Your Netlify CLI is too old for --allow-anonymous (it shipped 2026-03). ",
        "newer-cli-or-token",
      );
    }
    try {
      const { url, claimUrl, raw } = anonymousDeploy(publishDirAbs);
      const recPath = writeRecord(
        deployRecord({
          deployedAt: ctx.deployedAt, mode: "anonymous", publishDir: manifest.publishDir, fileCount,
          url, adminUrl: null, claimUrl, siteId: null, deployId: null,
          hasBackend: manifest.hasBackend, backendNote: manifest.backendNote, buildProducer: manifest.producer, stateFile,
        }),
      );
      return {
        ok: true,
        message:
          `Deployed anonymously.${url ? ` Live: ${url}` : ""}${claimUrl ? `\nClaim it within 1 hour (transfers ownership to your account): ${claimUrl}` : ""}` +
          `\nRecorded ${recPath}.${backendWarn}` +
          (!url || !claimUrl ? `\n(Could not parse a URL from the CLI output - see details.raw.)` : ""),
        details: { mode: "anonymous", url, claimUrl, fileCount, raw },
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message, details: { mode: "anonymous" } };
    }
  }

  // --- BYO-token path: deploy into the user's own account ---
  try {
    const r = await digestDeploy(files, { token, siteName: opts.siteName, siteId: opts.siteId });
    const recPath = writeRecord(
      deployRecord({
        deployedAt: ctx.deployedAt, mode: "token", publishDir: manifest.publishDir, fileCount,
        url: r.url || null, adminUrl: r.adminUrl || null, claimUrl: null, siteId: r.siteId, deployId: r.deployId,
        hasBackend: manifest.hasBackend, backendNote: manifest.backendNote, buildProducer: manifest.producer, stateFile,
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
