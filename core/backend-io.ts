// Node IO for the backend deploy automation: push env vars to the user's own
// Netlify site, optionally provision Neon (the user's own key), and optionally
// apply schema.sql. The deploy orchestration lives in deploy-io.ts; this file
// holds the backend-specific side effects so deploy-io.ts stays focused and
// core/backend.ts stays pure.
//
// SECRET DISCIPLINE (the whole point): secret VALUES are read ONLY from the
// process environment inside these functions. A value never arrives as a
// function/CLI parameter from the user, never lands in a deploy.json field,
// never appears in a returned message, and never rides on a command line (argv).
// Env values travel in an HTTPS request body (API) or a 0600 temp file
// (CLI import); the database URL reaches psql through child-process env vars,
// not argv. Env vars are recorded by NAME only.
//
// Copy rule for any user-facing string here: no em-dashes, no en-dashes, no
// spaced hyphen dashes.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvVarPlanItem } from "./backend.ts";

const NETLIFY_API = "https://api.netlify.com/api/v1";
const NEON_API = "https://console.neon.tech/api/v2";

type Env = Record<string, string | undefined>;

export interface EnvPushResult {
  method: "api" | "cli";
  set: string[]; // names actually pushed (value present in env)
  missing: string[]; // names declared but absent from the deploy environment
  note: string;
}

// ---- env vars via the account-level Netlify API (token path) -----------------

// GET the site to learn its account_slug, then POST the env vars (values pulled
// from `env`) to /accounts/{slug}/env. The value lives only in the JSON body.
export async function pushEnvVarsApi(
  siteId: string,
  token: string,
  plan: EnvVarPlanItem[],
  env: Env,
  accountSlug?: string,
): Promise<EnvPushResult> {
  const set: string[] = [];
  const missing: string[] = [];
  const body = plan
    .filter((p) => {
      const has = typeof env[p.name] === "string" && env[p.name] !== "";
      (has ? set : missing).push(p.name);
      return has;
    })
    .map((p) => ({
      key: p.name,
      scopes: p.scopes,
      is_secret: p.isSecret,
      values: [{ value: env[p.name] as string, context: p.context }],
    }));

  if (body.length === 0) {
    return { method: "api", set, missing, note: "no declared env var had a value in the deploy environment; nothing pushed" };
  }

  const slug = accountSlug || (await getAccountSlug(siteId, token));
  const res = await fetch(`${NETLIFY_API}/accounts/${encodeURIComponent(slug)}/env?site_id=${encodeURIComponent(siteId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Never echo the request body (it holds values); report status + names only.
    throw new Error(`Netlify env API ${res.status} ${res.statusText} when setting ${set.join(", ")}`);
  }
  return { method: "api", set, missing, note: "set via the Netlify API (secret-capable, scoped to builds and functions)" };
}

async function getAccountSlug(siteId: string, token: string): Promise<string> {
  const res = await fetch(`${NETLIFY_API}/sites/${encodeURIComponent(siteId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Netlify site lookup ${res.status} for env push`);
  const site = (await res.json()) as Record<string, unknown>;
  const slug = String(site["account_slug"] || site["account_id"] || "");
  if (!slug) throw new Error("could not resolve the account for env push");
  return slug;
}

// ---- env vars via the Netlify CLI (no-token path) ----------------------------

// Write the values to a 0600 temp file (NAME=value), import them, and delete the
// file in a finally. The CLI cannot mark a var secret and applies all scopes;
// the API path is preferred when a token is present.
export function cliImportEnv(plan: EnvVarPlanItem[], env: Env, siteId?: string): EnvPushResult {
  const set: string[] = [];
  const missing: string[] = [];
  const lines: string[] = [];
  for (const p of plan) {
    const v = env[p.name];
    if (typeof v === "string" && v !== "") {
      set.push(p.name);
      lines.push(`${p.name}=${v}`);
    } else {
      missing.push(p.name);
    }
  }
  if (lines.length === 0) {
    return { method: "cli", set, missing, note: "no declared env var had a value in the deploy environment; nothing imported" };
  }

  const dir = mkdtempSync(join(tmpdir(), "tl-env-"));
  const file = join(dir, ".env.import");
  try {
    writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
    const args = ["env:import", "--force", file, ...(siteId ? ["--site", siteId] : [])];
    const r = spawnSync("netlify", args, { encoding: "utf8", timeout: 60000 });
    if (r.status !== 0) {
      throw new Error(`netlify env:import failed (exit ${r.status}) for ${set.join(", ")}`);
    }
    return { method: "cli", set, missing, note: "imported via the Netlify CLI (applies all scopes; cannot mark secret)" };
  } finally {
    try { unlinkSync(file); } catch { /* best effort */ }
  }
}

// ---- database url resolution (BYO, env only) ---------------------------------

export interface DbUrlResult {
  name: string | null; // which env var name carried the value
  value: string | null; // the connection string (in memory only, never recorded)
}

// Prefer the portable DATABASE_URL, then the names Netlify managed Neon injects.
export function resolveDbUrl(env: Env): DbUrlResult {
  for (const name of ["DATABASE_URL", "NETLIFY_DATABASE_URL", "NETLIFY_DATABASE_URL_UNPOOLED"]) {
    const v = env[name];
    if (typeof v === "string" && v !== "") return { name, value: v };
  }
  return { name: null, value: null };
}

// ---- opt-in Neon provisioning (the user's own key) ---------------------------

export interface ProvisionResult {
  provisioned: boolean;
  url: string | null; // connection string in memory only
  note: string;
}

// Create a Neon project with the user's OWN NEON_API_KEY (BYOK; no central
// account). Returns the connection string in memory. The default deploy path
// does NOT call this; it runs only behind the explicit --provision-db flag.
export async function provisionNeon(env: Env): Promise<ProvisionResult> {
  const key = env["NEON_API_KEY"] || "";
  if (!key) {
    return { provisioned: false, url: null, note: "set NEON_API_KEY to provision, or set DATABASE_URL to bring your own database" };
  }
  try {
    const res = await fetch(`${NEON_API}/projects`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ project: {} }),
    });
    if (!res.ok) {
      return { provisioned: false, url: null, note: `Neon API ${res.status} ${res.statusText} when creating the project` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const uris = Array.isArray(data["connection_uris"]) ? (data["connection_uris"] as Array<Record<string, unknown>>) : [];
    const uri = uris.length ? String(uris[0]?.["connection_uri"] || "") : "";
    if (!uri) return { provisioned: false, url: null, note: "Neon created the project but returned no connection string" };
    return { provisioned: true, url: uri, note: "provisioned a Neon project in your account (connection string set for this deploy only)" };
  } catch (e) {
    return { provisioned: false, url: null, note: `Neon provisioning error: ${(e as Error).message}` };
  }
}

// ---- opt-in schema apply via psql --------------------------------------------

export interface SchemaResult {
  applied: boolean;
  note: string;
}

// Apply schema.sql to the database with psql. The connection string reaches psql
// through libpq environment variables (PGHOST, PGUSER, ...), never argv, so the
// value cannot leak onto a command line. Runs only behind the --apply-schema
// flag. If psql is absent, print the manual command and report applied:false.
export function applySchema(schemaPath: string, dbUrl: string | null, env: Env): SchemaResult {
  if (!existsSync(schemaPath)) {
    return { applied: false, note: `schema file not found at ${schemaPath}` };
  }
  if (!dbUrl) {
    return { applied: false, note: "no database connection string available; set DATABASE_URL or use --provision-db" };
  }
  const probe = spawnSync("psql", ["--version"], { encoding: "utf8", timeout: 15000 });
  if (probe.status !== 0) {
    return { applied: false, note: `psql is not installed; apply it manually: psql "$DATABASE_URL" -f ${schemaPath}` };
  }
  let pg: Env;
  try {
    pg = libpqEnv(dbUrl);
  } catch {
    return { applied: false, note: "could not parse the database connection string" };
  }
  const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-f", schemaPath], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...env, ...pg },
  });
  if (r.status !== 0) {
    return { applied: false, note: `psql exited ${r.status} applying the schema` };
  }
  return { applied: true, note: "applied schema.sql with psql" };
}

// Split a Postgres connection string into libpq env vars so the secret never
// touches argv. Throws on an unparseable URL.
function libpqEnv(dbUrl: string): Env {
  const u = new URL(dbUrl);
  const pg: Env = {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "neondb",
  };
  if (u.username) pg["PGUSER"] = decodeURIComponent(u.username);
  if (u.password) pg["PGPASSWORD"] = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get("sslmode");
  pg["PGSSLMODE"] = sslmode || "require";
  return pg;
}
