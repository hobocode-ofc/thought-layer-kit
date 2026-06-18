// The typed contract + deterministic boilerplate for the backend-capable build.
//
// Static stays the default. When the build skill's three-question backend test
// says a product genuinely needs a server (a browser-unsafe secret, shared or
// persistent state, or trusted server-side enforcement), the agent emits a real
// serverless backend alongside the static front end. This module is the
// deterministic floor for that path, mirroring scaffold.ts: the agent supplies
// judgment (which functions, which tables), and these pure helpers render the
// fixed, dash-free boilerplate (the env contract and the deploy guide) and
// coerce a hand-written backend block into a clean shape.
//
// Pure TypeScript, no node imports. The chosen runtime DB driver
// (`@neondatabase/serverless`) is a dependency of the GENERATED product, never
// of the kit. Nothing here holds or provisions credentials: secrets live only
// in the host environment, and the emitted .env.example carries names, never
// values.
//
// Copy rule (enforced by tests): no em-dashes, no en-dashes, and no spaced
// hyphen dashes (" - ", " -- ") in any generated prose. Use commas, colons,
// periods, and parentheses instead.

export type BackendKind = "serverless" | "server" | null;

// One environment variable the backend reads. Names only: a value never lives
// in this spec, the manifest, or the emitted .env.example. Real values stay in
// the host environment.
export interface EnvVarSpec {
  name: string;
  required: boolean;
  description: string;
}

// Where the backend keeps shared or persistent state. The kit's documented
// default is Neon Postgres, reached through the `DATABASE_URL` connection
// string. Overridable to any Postgres by pointing `DATABASE_URL` elsewhere.
export interface DatabaseSpec {
  provider: string; // "neon" by default
  schemaFile: string; // "schema.sql"
  envVar: string; // "DATABASE_URL"
}

// The structured backend payload carried on the build manifest. The build skill
// writes it when hasBackend is true; the deploy-automation follow-up consumes
// it. Today the deploy step only reads it for messaging.
export interface BackendMeta {
  backendKind: BackendKind;
  functionsDir: string; // "netlify/functions"
  runtime: string; // "nodejs20.x"
  nodeVersion: string; // "20"
  envVars: EnvVarSpec[];
  database: DatabaseSpec | null;
  guide: string; // "BACKEND.md"
}

// The single documented default database. Neon is also exactly what managed
// Netlify DB provisions, so it is both the Netlify native choice and portable.
export const NEON_DEFAULT_DB: DatabaseSpec = {
  provider: "neon",
  schemaFile: "schema.sql",
  envVar: "DATABASE_URL",
};

// ---- helpers -----------------------------------------------------------------

// Coerce a name to a safe environment-variable identifier. Real env var names
// are UPPER_SNAKE; this hardens the names-only invariant so a stray space or
// lowercase letter can never produce a line that fails the `^[A-Z0-9_]+=$`
// security check.
function envName(raw: string): string {
  const cleaned = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "VAR";
}

// Dedupe by safe name and sort, so the same set of vars always renders byte for
// byte the same regardless of input order.
function dedupeSortEnv(envVars: EnvVarSpec[]): EnvVarSpec[] {
  const seen = new Set<string>();
  const out: EnvVarSpec[] = [];
  for (const v of envVars || []) {
    const name = envName(v?.name ?? "");
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, required: v?.required !== false, description: String(v?.description ?? "") });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---- the names-only env contract ---------------------------------------------

// Render a deterministic .env.example. Every variable line is exactly `NAME=`
// with nothing after the equals sign. The security invariant (no value is ever
// written) is locked by a unit test that matches `^[A-Z0-9_]+=$` on every
// non-comment, non-blank line.
export function renderEnvExample(envVars: EnvVarSpec[]): string {
  const vars = dedupeSortEnv(envVars);
  const lines: string[] = [
    "# Environment variables for this project.",
    "# Names only. Real values live in your host environment (the Netlify UI, or netlify env:set), never in this file.",
    "# Copy this file to .env for local work and fill the values there. .env is gitignored; this .env.example is committed so the contract travels with the repo.",
  ];
  if (vars.length === 0) {
    lines.push("", "# No backend environment variables were declared for this build.");
    return lines.join("\n") + "\n";
  }
  for (const v of vars) {
    const note = v.description.trim() ? v.description.trim() : "Set this value in your host environment.";
    lines.push("", `# ${note} (${v.required ? "required" : "optional"})`, `${v.name}=`);
  }
  return lines.join("\n") + "\n";
}

// ---- the deploy guide --------------------------------------------------------

export interface BackendEndpoint {
  name: string; // function file name without extension, glossary-named
  rid: string; // the backend requirement id it implements
  summary: string; // one line of what it does
}

export interface BackendGuideInput {
  brandName?: string;
  backendKind?: BackendKind;
  functionsDir?: string;
  runtime?: string;
  database?: DatabaseSpec | null;
  envVars?: EnvVarSpec[];
  endpoints?: BackendEndpoint[];
}

const cell = (s: string): string => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

// Render a deterministic BACKEND.md for the Neon-on-Netlify path. The agent
// supplies the endpoint and env lists; the prose, section order, and the honest
// "deploy automation is a follow-up" status are fixed and dash-free.
export function renderBackendGuide(input: BackendGuideInput): string {
  const brand = (input.brandName || "This project").trim() || "This project";
  const functionsDir = (input.functionsDir || "netlify/functions").trim() || "netlify/functions";
  const db = input.database ?? NEON_DEFAULT_DB;
  const envVars = dedupeSortEnv(input.envVars || []);
  const endpoints = [...(input.endpoints || [])].sort(
    (a, b) => String(a.rid).localeCompare(String(b.rid)) || String(a.name).localeCompare(String(b.name)),
  );

  const envRows =
    envVars.length > 0
      ? envVars
          .map((v) => `| \`${v.name}\` | ${v.required ? "yes" : "no"} | ${cell(v.description) || "Set in your host environment."} |`)
          .join("\n")
      : `| \`${db.envVar}\` | yes | ${db.provider === "neon" ? "Neon Postgres connection string" : "Database connection string"} |`;

  const fnRows =
    endpoints.length > 0
      ? endpoints.map((e) => `| \`${cell(e.name)}\` | ${cell(e.rid)} | ${cell(e.summary) || "See the function source."} |`).join("\n")
      : "| (none emitted) | n/a | This build declared a backend but wrote no functions; see DECISIONS.md. |";

  return `# Backend deploy guide

${brand} needs a server side, so the build emitted a backend alongside the static front end. This guide covers what is in the repo, the honest status of automated backend deploy, and the one-time manual steps to take it live yourself.

## What is in the repo

- \`${functionsDir}/\`: one serverless function per backend requirement (the table further down maps each to its R-ID). The front end calls a function at \`/.netlify/functions/<name>\`.
- \`${db.schemaFile}\`: the database schema. Tables and columns use the project glossary terms. Apply it once against your database.
- \`.env.example\`: the environment variable names this backend reads. Names only, no values. Copy it to \`.env\` for local work and set real values in your host environment.
- \`netlify.toml\`: declares the functions directory (\`[functions] directory = "${functionsDir}"\`) so Netlify bundles and serves the functions next to the static publish directory.

## Status: automated backend deploy is a follow-up

\`tl deploy\` publishes the static front end today. It does not yet provision the database or ship the functions for you; that automation is the next piece of work. Until it lands, do the steps below once. The front end deploys and works now; the functions go live when you complete these steps.

## 1. Provision the database

The documented default is Neon Postgres. Netlify DB is managed Neon, so this is the Netlify native choice as well as a portable one.

1. Create a Neon project at neon.tech, or run \`netlify db init\` to provision managed Neon from your own Netlify account.
2. Copy the connection string. It looks like \`postgresql://USER:PASSWORD@HOST/DB?sslmode=require\`.
3. Apply the schema once: \`psql "$${db.envVar}" -f ${db.schemaFile}\`.

When you provision managed Neon through Netlify, Netlify sets \`NETLIFY_DATABASE_URL\` for you. The code reads \`${db.envVar}\` as the portable name, so set that (or map one to the other) in the next step.

To use a different Postgres provider, point \`${db.envVar}\` at it instead. Any standard Postgres works with the Neon serverless driver, so this is not locked to one vendor.

## 2. Set the environment variables

Set these in your host environment (the Netlify UI under Site settings, Environment variables, or \`netlify env:set NAME value\`). Never commit real values; \`.env.example\` carries names only.

| Variable | Required | Purpose |
| --- | --- | --- |
${envRows}

## 3. The functions

Each backend requirement maps to one function. The front end reaches it at \`/.netlify/functions/<name>\`.

| Function | Requirement | Does |
| --- | --- | --- |
${fnRows}

## 4. Deploy with the functions present

1. Confirm \`netlify.toml\` declares the functions directory.
2. Set the environment variables from step 2 on the target site.
3. From the project root, with the functions in place, run \`netlify deploy --prod\`. (Once the backend deploy automation lands, \`tl deploy\` will do this for you.)

\`netlify deploy\` ships both the static publish directory and the functions in one go. After it completes, call a function once to confirm it responds, then use the live site.
`;
}

// ---- defensive normalizer ----------------------------------------------------

function normalizeDatabase(raw: unknown): DatabaseSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, fb: string): string => (typeof v === "string" && v.trim() ? v.trim() : fb);
  return {
    provider: str(r["provider"], "neon"),
    schemaFile: str(r["schemaFile"], "schema.sql"),
    envVar: str(r["envVar"], "DATABASE_URL"),
  };
}

function normalizeEnvVars(raw: unknown): EnvVarSpec[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EnvVarSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r["name"] === "string" ? r["name"].trim() : "";
    if (!name) continue; // drop nameless vars
    if (seen.has(name)) continue; // dedupe
    seen.add(name);
    out.push({
      name,
      required: typeof r["required"] === "boolean" ? r["required"] : true,
      description: typeof r["description"] === "string" ? r["description"] : "",
    });
  }
  return out;
}

// Coerce a hand-written backend block (the agent fills it into build.json) into
// a clean BackendMeta, or null when there is nothing recognizable. Mirrors the
// progress.ts normalizers: forgiving on input, strict on output.
export function normalizeBackendMeta(raw: unknown): BackendMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const kindRaw = r["backendKind"];
  const kind: BackendKind = kindRaw === "server" ? "server" : kindRaw === "serverless" ? "serverless" : null;
  const envVars = normalizeEnvVars(r["envVars"]);
  const database = normalizeDatabase(r["database"]);
  const hasFunctionsDir = typeof r["functionsDir"] === "string" && (r["functionsDir"] as string).trim().length > 0;

  // Nothing the deploy step could act on: treat as no backend.
  if (kind === null && envVars.length === 0 && database === null && !hasFunctionsDir) return null;

  const str = (v: unknown, fb: string): string => (typeof v === "string" && v.trim() ? v.trim() : fb);
  return {
    backendKind: kind ?? "serverless",
    functionsDir: str(r["functionsDir"], "netlify/functions"),
    runtime: str(r["runtime"], "nodejs20.x"),
    nodeVersion: str(r["nodeVersion"], "20"),
    envVars,
    database,
    guide: str(r["guide"], "BACKEND.md"),
  };
}

// ---- deploy planning (pure; the deploy step's node IO consumes these) --------

// One environment variable the deploy will set on the user's site, expressed as
// NAME + policy only. There is deliberately no value field: the deploy reads the
// value from its own process.env at run time and never carries it through here.
export interface EnvVarPlanItem {
  name: string;
  scopes: string[]; // Netlify env scopes; functions need "functions", builds keep "builds"
  isSecret: boolean; // mark connection strings / keys / tokens as secret in the Netlify API
  context: string; // Netlify deploy context the value applies to
}

// Names that should be marked secret on Netlify (write-only there). A coarse,
// safe-by-default match: anything that looks like a credential is secret.
const SECRET_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|DATABASE_URL|DB_URL|CONN|DSN|CREDENTIAL|PRIVATE|AUTH)/;

function looksSecret(name: string): boolean {
  return SECRET_NAME_RE.test(name.toUpperCase());
}

// Plan the env vars to push: the backend's declared names plus the database
// connection var, deduped and sorted (via dedupeSortEnv, so names are sanitized
// the same way the .env.example is). Names + policy only, never values.
export function planEnvVars(backend: BackendMeta): EnvVarPlanItem[] {
  const dbVar = backend.database?.envVar ? backend.database.envVar : "";
  const merged: EnvVarSpec[] = [
    ...(backend.envVars || []),
    ...(dbVar ? [{ name: dbVar, required: true, description: "" }] : []),
  ];
  return dedupeSortEnv(merged).map((v) => ({
    name: v.name,
    scopes: ["builds", "functions"],
    isSecret: looksSecret(v.name),
    context: "all",
  }));
}

export interface FunctionsPlan {
  functionsDir: string; // relative dir from build.json (e.g. "netlify/functions")
  runtime: string; // Netlify function runtime; serverless TypeScript bundles as "js"
}

export function planFunctions(backend: BackendMeta): FunctionsPlan {
  return { functionsDir: backend.functionsDir || "netlify/functions", runtime: "js" };
}
