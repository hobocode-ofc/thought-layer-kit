import { describe, it, expect } from "vitest";
import {
  renderEnvExample, renderBackendGuide, normalizeBackendMeta, NEON_DEFAULT_DB,
  type EnvVarSpec, type BackendGuideInput,
} from "./backend.ts";

// The dash ban for generated user-facing copy: no em-dash, no en-dash, and no
// spaced hyphen dashes (" - ", " -- "). Hyphenated compounds ("names-only") and
// markdown table delimiters ("| --- |") are allowed.
const hasBannedDash = (s: string): boolean =>
  s.includes("—") || s.includes("–") || s.includes(" - ") || s.includes(" -- ");

const env = (name: string, required: boolean, description = ""): EnvVarSpec => ({ name, required, description });

describe("renderEnvExample", () => {
  const vars = [env("DATABASE_URL", true, "Neon Postgres connection string"), env("STRIPE_SECRET_KEY", false, "Stripe API key")];

  it("writes only NAME= lines, never a value (the security invariant)", () => {
    const out = renderEnvExample(vars);
    const varLines = out.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(varLines.length).toBe(2);
    for (const line of varLines) {
      expect(line).toMatch(/^[A-Z0-9_]+=$/); // exactly NAME=, nothing after the equals
    }
  });

  it("hardens any messy name into a safe NAME= line with no value", () => {
    const out = renderEnvExample([env("my api key", true, "x"), env("weird-name!", true, "y")]);
    const varLines = out.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    for (const line of varLines) expect(line).toMatch(/^[A-Z0-9_]+=$/);
    expect(out).toContain("MY_API_KEY=");
    expect(out).toContain("WEIRD_NAME=");
    // and still never an assigned value
    expect(out).not.toMatch(/=[^\n]+/);
  });

  it("labels each variable required or optional", () => {
    const out = renderEnvExample(vars);
    expect(out).toMatch(/# Neon Postgres connection string \(required\)/);
    expect(out).toMatch(/# Stripe API key \(optional\)/);
  });

  it("is deterministic and order-independent (dedupe + sort)", () => {
    const a = renderEnvExample(vars);
    const b = renderEnvExample([...vars].reverse());
    expect(a).toBe(b); // sorted, so input order does not matter
    // dedupe by name
    const dup = renderEnvExample([env("DATABASE_URL", true, "first"), env("DATABASE_URL", true, "second")]);
    expect(dup.match(/DATABASE_URL=/g)?.length).toBe(1);
  });

  it("renders without any banned dash", () => {
    expect(hasBannedDash(renderEnvExample(vars))).toBe(false);
    expect(hasBannedDash(renderEnvExample([]))).toBe(false);
  });
});

describe("renderBackendGuide", () => {
  const input: BackendGuideInput = {
    brandName: "Acme Dispatch",
    backendKind: "serverless",
    functionsDir: "netlify/functions",
    runtime: "nodejs20.x",
    database: NEON_DEFAULT_DB,
    envVars: [env("DATABASE_URL", true, "Neon Postgres connection string")],
    endpoints: [
      { name: "dispatch", rid: "R-007", summary: "Create a dispatch for a crew" },
      { name: "schedule", rid: "R-004", summary: "List the day's schedule" },
    ],
  };

  it("documents the Neon-on-Netlify path with the key facts", () => {
    const md = renderBackendGuide(input);
    expect(md).toContain("Neon");
    expect(md).toContain("neon.tech");
    expect(md).toContain("Netlify DB is managed Neon");
    expect(md).toContain("DATABASE_URL");
    expect(md).toContain("NETLIFY_DATABASE_URL");
    expect(md).toContain("netlify deploy");
    expect(md).toContain("schema.sql");
    expect(md).toContain(".env.example");
  });

  it("is honest that automated backend deploy is a follow-up", () => {
    const md = renderBackendGuide(input);
    expect(md).toContain("follow-up");
    expect(md.toLowerCase()).toContain("static front end");
  });

  it("has an env-var table and a functions table keyed by R-ID", () => {
    const md = renderBackendGuide(input);
    expect(md).toContain("| Variable | Required | Purpose |");
    expect(md).toContain("`DATABASE_URL`");
    expect(md).toContain("| Function | Requirement | Does |");
    expect(md).toContain("R-007");
    expect(md).toContain("R-004");
    // endpoints are sorted by R-ID, so R-004 appears before R-007
    expect(md.indexOf("R-004")).toBeLessThan(md.indexOf("R-007"));
  });

  it("explains the provider override (any Postgres)", () => {
    const md = renderBackendGuide(input);
    expect(md).toContain("different Postgres provider");
    expect(md.toLowerCase()).toContain("not locked to one vendor");
  });

  it("is deterministic and dash-free", () => {
    expect(renderBackendGuide(input)).toBe(renderBackendGuide(input));
    expect(hasBannedDash(renderBackendGuide(input))).toBe(false);
    // also dash-free with empty inputs (defaults kick in)
    expect(hasBannedDash(renderBackendGuide({}))).toBe(false);
  });
});

describe("normalizeBackendMeta", () => {
  it("returns null on garbage or nothing recognizable", () => {
    expect(normalizeBackendMeta(null)).toBeNull();
    expect(normalizeBackendMeta(undefined)).toBeNull();
    expect(normalizeBackendMeta(42)).toBeNull();
    expect(normalizeBackendMeta("backend")).toBeNull();
    expect(normalizeBackendMeta([])).toBeNull();
    expect(normalizeBackendMeta({})).toBeNull(); // empty object = no backend
  });

  it("coerces a hand-written block, defaulting the database to neon", () => {
    const m = normalizeBackendMeta({
      backendKind: "serverless",
      functionsDir: "netlify/functions",
      envVars: [
        { name: "DATABASE_URL", required: true, description: "conn" },
        { description: "no name here" }, // dropped
        { name: "DATABASE_URL", required: true }, // duplicate dropped
      ],
      database: {}, // present but empty -> neon defaults
    });
    expect(m).not.toBeNull();
    expect(m!.backendKind).toBe("serverless");
    expect(m!.functionsDir).toBe("netlify/functions");
    expect(m!.runtime).toBe("nodejs20.x"); // defaulted
    expect(m!.envVars).toHaveLength(1); // nameless + duplicate dropped
    expect(m!.envVars[0]!.name).toBe("DATABASE_URL");
    expect(m!.database).toEqual({ provider: "neon", schemaFile: "schema.sql", envVar: "DATABASE_URL" });
  });

  it("forces required to a real boolean (default true)", () => {
    const m = normalizeBackendMeta({
      functionsDir: "netlify/functions",
      envVars: [{ name: "A" }, { name: "B", required: false }, { name: "C", required: "yes" }],
    });
    expect(m!.envVars.find((v) => v.name === "A")!.required).toBe(true); // missing -> true
    expect(m!.envVars.find((v) => v.name === "B")!.required).toBe(false);
    expect(m!.envVars.find((v) => v.name === "C")!.required).toBe(true); // non-boolean -> true
  });

  it("treats a lone signal (functionsDir) as a backend and defaults the kind", () => {
    const m = normalizeBackendMeta({ functionsDir: "netlify/functions" });
    expect(m).not.toBeNull();
    expect(m!.backendKind).toBe("serverless"); // invalid/absent kind defaults to serverless
    expect(m!.database).toBeNull(); // no database declared -> stays null
  });
});
