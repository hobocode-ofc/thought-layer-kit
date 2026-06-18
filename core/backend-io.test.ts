import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDbUrl, cliImportEnv, pushEnvVarsApi, provisionNeon, applySchema } from "./backend-io.ts";
import { planEnvVars, type BackendMeta } from "./backend.ts";

// These tests exercise only the guard / pure paths: every case here returns
// BEFORE any network call or process spawn, so the suite never touches Netlify,
// Neon, or psql. The live paths are verified manually (see the plan).

const backend: BackendMeta = {
  backendKind: "serverless", functionsDir: "netlify/functions", runtime: "nodejs20.x", nodeVersion: "20",
  envVars: [{ name: "DATABASE_URL", required: true, description: "" }, { name: "API_KEY", required: true, description: "" }],
  database: { provider: "neon", schemaFile: "schema.sql", envVar: "DATABASE_URL" }, guide: "BACKEND.md",
};
const plan = planEnvVars(backend);

describe("resolveDbUrl", () => {
  it("prefers DATABASE_URL, then the Netlify managed names", () => {
    expect(resolveDbUrl({ DATABASE_URL: "a", NETLIFY_DATABASE_URL: "b" }).name).toBe("DATABASE_URL");
    expect(resolveDbUrl({ NETLIFY_DATABASE_URL: "b", NETLIFY_DATABASE_URL_UNPOOLED: "c" }).name).toBe("NETLIFY_DATABASE_URL");
    expect(resolveDbUrl({ NETLIFY_DATABASE_URL_UNPOOLED: "c" }).name).toBe("NETLIFY_DATABASE_URL_UNPOOLED");
    expect(resolveDbUrl({}).name).toBeNull();
  });
});

describe("cliImportEnv (guard path)", () => {
  it("skips the spawn and reports all names missing when no value is in the environment", () => {
    const r = cliImportEnv(plan, {}); // empty env -> early return, no netlify spawn
    expect(r.method).toBe("cli");
    expect(r.set).toEqual([]);
    expect(r.missing.sort()).toEqual(["API_KEY", "DATABASE_URL"]);
  });
});

describe("pushEnvVarsApi (guard path)", () => {
  it("returns without a network call when nothing has a value", async () => {
    const r = await pushEnvVarsApi("site-id", "token", plan, {}); // empty env -> body empty -> no fetch
    expect(r.method).toBe("api");
    expect(r.set).toEqual([]);
    expect(r.missing.sort()).toEqual(["API_KEY", "DATABASE_URL"]);
  });
});

describe("provisionNeon (guard path)", () => {
  it("does nothing without NEON_API_KEY and guides to BYO DATABASE_URL", async () => {
    const r = await provisionNeon({}); // no key -> no network
    expect(r.provisioned).toBe(false);
    expect(r.url).toBeNull();
    expect(r.note).toContain("NEON_API_KEY");
  });
});

describe("applySchema (guard path)", () => {
  it("reports a missing schema file without spawning psql", () => {
    const r = applySchema("/no/such/schema.sql", "postgresql://u:p@h/db", {});
    expect(r.applied).toBe(false);
    expect(r.note).toContain("not found");
  });

  it("reports a missing database url without spawning psql", () => {
    const dir = mkdtempSync(join(tmpdir(), "tl-schema-"));
    const f = join(dir, "schema.sql");
    writeFileSync(f, "create table if not exists widget (id serial primary key);\n");
    const r = applySchema(f, null, {});
    expect(r.applied).toBe(false);
    expect(r.note.toLowerCase()).toContain("connection string");
  });
});
