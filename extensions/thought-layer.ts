// The Thought Layer Pi extension. It exposes the deterministic core as tools so
// the agent never has to re-derive the math: confidence scoring, domain
// availability, and the numeric projection. The methodology itself lives in the
// skills (thought-layer-panel / grill / prd / naming); this is the engine.

import type { ExtensionAPI, ToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  aggregateConfidence, statusFromConfidence, gradeFromConfidence,
  checkDomains, registrarSearchUrl,
  computeProjection, fmtMoney,
  applyStateOp, runScaffold, runDeploy,
  type Assumptions, type StateOp,
} from "../core/index.ts";

const text = (t: string, details?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: t }],
  details: details ?? {},
});

export default function (pi: ExtensionAPI) {
  // tl_score: aggregate persona confidences into a status + letter grade,
  // using the exact bands from the web app (green >= 0.85, yellow >= 0.6).
  pi.registerTool({
    name: "tl_score",
    label: "Thought Layer: score",
    description:
      "Aggregate one or more confidence values (0 to 1) into a stoplight status and a letter grade, using The Thought Layer's exact bands. Use after a panel evaluation to compute the verdict instead of guessing the grade.",
    parameters: Type.Object({
      confidences: Type.Array(Type.Number(), {
        description: "Confidence values 0 to 1 (e.g. one per persona in panel mode).",
      }),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const { confidences } = params as { confidences: number[] };
      const confidence = aggregateConfidence(confidences);
      if (confidence === null) return text("No numeric confidences provided.", { confidence: null });
      const status = statusFromConfidence(confidence);
      const grade = gradeFromConfidence(confidence);
      return text(
        `Aggregate confidence ${(confidence * 100).toFixed(0)}% -> status ${status}, grade ${grade}. ` +
          `Goal is 0.85+ (green). ${status === "green" ? "Sufficient to move on." : "Keep refining or set aside with to-dos."}`,
        { confidence, status, grade },
      );
    },
  });

  // tl_domains: check availability via the user's own RapidAPI key (BYOK, from
  // env). With no key, return a registrar search link instead of calling out.
  pi.registerTool({
    name: "tl_domains",
    label: "Thought Layer: domains",
    description:
      "Check domain availability for a name slug across common TLDs. Reads a RapidAPI key from THOUGHT_LAYER_DOMAIN_KEY or RAPIDAPI_KEY (BYOK). With no key set, returns a registrar search link rather than calling out.",
    parameters: Type.Object({
      slug: Type.String({ description: "Domain-ready base, lowercase, no TLD (e.g. 'acmedispatch')." }),
      tlds: Type.Optional(Type.Array(Type.String(), { description: "TLDs to check; defaults to com, io, app, co." })),
    }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const { slug, tlds } = params as { slug: string; tlds?: string[] };
      const key = process.env.THOUGHT_LAYER_DOMAIN_KEY || process.env.RAPIDAPI_KEY || "";
      const results = await checkDomains(slug, key, { signal, tlds });
      if (results === null) {
        return text(
          `No domain key set, so I did not call out. Search manually: ${registrarSearchUrl(slug)}`,
          { hasKey: false, searchUrl: registrarSearchUrl(slug) },
        );
      }
      const lines = results.map((r) => `${r.available ? "available" : r.error ? "check failed" : "taken"}: ${r.domain}`);
      return text(`Domain availability for "${slug}":\n${lines.join("\n")}`, { results });
    },
  });

  // tl_project: run the deterministic monthly projection from business-model
  // assumptions and return the headline summary.
  const PartySchema = Type.Object({
    id: Type.String(),
    name: Type.Optional(Type.String()),
    startingCount: Type.Optional(Type.Number()),
    monthlyNewBase: Type.Optional(Type.Number()),
    monthlyNewGrowthPct: Type.Optional(Type.Number()),
    monthlyChurnPct: Type.Optional(Type.Number()),
    revenuePerUnitPerMonth: Type.Optional(Type.Number()),
    variableCostPerUnitPerMonth: Type.Optional(Type.Number()),
    cacPerUnit: Type.Optional(Type.Number()),
  });
  const FixedCostSchema = Type.Object({
    id: Type.String(),
    name: Type.Optional(Type.String()),
    monthlyAmount: Type.Optional(Type.Number()),
    startMonth: Type.Optional(Type.Number()),
  });
  const OneTimeCostSchema = Type.Object({
    id: Type.String(),
    name: Type.Optional(Type.String()),
    amount: Type.Optional(Type.Number()),
    month: Type.Optional(Type.Number()),
  });
  pi.registerTool({
    name: "tl_project",
    label: "Thought Layer: project",
    description:
      "Run The Thought Layer's deterministic monthly business projection from structured assumptions (parties, fixed costs, one-time costs, horizon). Returns break-even, year-1 revenue and net, max cash drawdown, and ending MRR. Use this instead of estimating the numbers.",
    parameters: Type.Object({
      parties: Type.Array(PartySchema),
      fixedCosts: Type.Optional(Type.Array(FixedCostSchema)),
      oneTimeCosts: Type.Optional(Type.Array(OneTimeCostSchema)),
      horizonMonths: Type.Optional(Type.Number()),
      currency: Type.Optional(Type.String()),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const a = params as Assumptions;
      const p = computeProjection(a);
      if (!p) return text("No parties provided, so there is nothing to project.", {});
      const s = p.summary;
      const cur = a.currency || "USD";
      const body = [
        `Horizon: ${s.horizon} months`,
        `Monthly break-even: ${s.breakEvenMonth ? `month ${s.breakEvenMonth}` : "beyond horizon"}`,
        `Cumulative break-even: ${s.cumBreakEvenMonth ? `month ${s.cumBreakEvenMonth}` : "beyond horizon"}`,
        `Year-1 revenue: ${fmtMoney(s.year1Revenue, cur)}`,
        `Year-1 net: ${fmtMoney(s.year1Net, cur)}`,
        `Max cash drawdown: ${fmtMoney(s.maxDrawdown, cur)}`,
        `Ending MRR: ${fmtMoney(s.endingMRR, cur)}`,
      ].join("\n");
      return text(`Projection summary:\n${body}`, { summary: s });
    },
  });

  // tl_state: read, update, and write the portable Thought Layer state file
  // (.thought-layer/state.json) so a co-founder using the web app and an agent
  // share ONE lossless file. This owns the feedback-envelope assembly and
  // artifact normalization, so the model supplies prose + numbers and never
  // hand-writes the JSON (the main way the file gets corrupted).
  const SuggestionSchema = Type.Object({
    id: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    patch: Type.Optional(Type.String()),
  });
  const PersonaSchema = Type.Object({
    persona: Type.String({ description: "redteam | expert | investor, or the single chosen persona key." }),
    assessment: Type.Optional(Type.String()),
    confidence: Type.Number({ description: "0 to 1, this persona's confidence." }),
    confidenceRationale: Type.Optional(Type.String()),
    suggestions: Type.Optional(Type.Array(SuggestionSchema)),
  });
  pi.registerTool({
    name: "tl_state",
    label: "Thought Layer: state",
    description:
      "Read, update, and write a portable Thought Layer progress file (default .thought-layer/state.json) shared with the web app so work passes losslessly between a founder in the browser and an agent. " +
      "ops: 'read' (resume: where the run stands), 'list' (list the state files under .thought-layer/ when juggling several ideas), 'answer' (record a question answer), 'feedback' (record a panel verdict - pass it the per-persona prose + confidences and it builds the exact entry), " +
      "'artifact' (store prd/grill/bizModel/naming/brand/etc., requirements auto-normalized), 'cursor' (save resume position), 'park' (stash a panel note with no web-app question), 'export' (report the current file for handoff). " +
      "To juggle several ideas, give each its own file via `path` (e.g. .thought-layer/acme.json) and use the same path for every op in the session. Always use this instead of writing the JSON by hand.",
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal("read"), Type.Literal("list"), Type.Literal("answer"), Type.Literal("feedback"),
        Type.Literal("artifact"), Type.Literal("cursor"), Type.Literal("park"), Type.Literal("export"),
      ], { description: "The operation to perform." }),
      path: Type.Optional(Type.String({ description: "Project dir or .json path; selects WHICH state file to use. Defaults to ./.thought-layer/state.json. Use a named file (e.g. .thought-layer/acme.json) to keep ideas separate; for 'list', a project dir to scan." })),
      qId: Type.Optional(Type.String({ description: "Question id (for 'answer'/'feedback'). Must be a real Thought Layer question id." })),
      value: Type.Optional(Type.Unknown({ description: "For 'answer': the answer string. For 'artifact': the artifact object." })),
      artifact: Type.Optional(Type.String({ description: "For 'artifact': one of bizModel, grill, assets, research, swot, prd, naming, brand." })),
      mode: Type.Optional(Type.String({ description: "For 'feedback': 'panel' (3 personas) or a single persona key." })),
      personas: Type.Optional(Type.Array(PersonaSchema, { description: "For 'feedback': one entry per persona with its assessment + confidence." })),
      endState: Type.Optional(Type.String({ description: "For 'feedback': 'open' (still iterating), 'pass' (cleared 0.85), or 'setAside' (frozen with to-dos)." })),
      round: Type.Optional(Type.Number({ description: "For 'feedback': which feedback round this is (default 1)." })),
      cursor: Type.Optional(Type.Object({
        stage: Type.Optional(Type.String()),
        backboneStage: Type.Optional(Type.Number()),
        lastQuestionId: Type.Optional(Type.String()),
        phase: Type.Optional(Type.String()),
      }, { description: "For 'cursor': the resume position." })),
      key: Type.Optional(Type.String({ description: "For 'park': a synthetic note key, e.g. 'brand.voice' or 'mr.willingness-to-pay'." })),
      note: Type.Optional(Type.String({ description: "For 'park': the note to stash under the kit namespace." })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const r = applyStateOp(params as StateOp, { ts: Date.now(), exportedAt: new Date().toISOString() });
      return text(r.message, r.details);
    },
  });

  // tl_scaffold: deterministically generate a self-contained, branded,
  // SEO-complete static site (the instantly-deployable floor) from the spec +
  // brand in the state file - no model needed. Writes the site to a publish dir
  // plus a build.json manifest the deploy step consumes.
  pi.registerTool({
    name: "tl_scaffold",
    label: "Thought Layer: scaffold",
    description:
      "Deterministically scaffold a self-contained, branded, SEO-complete static landing site (an instantly-deployable floor) from the spec + brand in the state file - no model call. " +
      "Use it for the fastest path to something live, or as the floor when a model build is thin or fails. Writes the site (index.html + llms.txt/robots.txt/sitemap.xml/_redirects/netlify.toml/SEO.md) to the publish dir and a build.json manifest for the deploy step. " +
      "The full product is built by the thought-layer-build skill; this is the guaranteed deployable baseline.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "State file (or project dir) to read the spec + brand from. Defaults to ./.thought-layer/state.json; honors a named file." })),
      outDir: Type.Optional(Type.String({ description: "Publish directory to write the site into. Defaults to ./dist." })),
      domain: Type.Optional(Type.String({ description: "The site's real domain (e.g. https://acme.com) for canonical/OG/sitemap. Defaults to a placeholder you fill later." })),
      founder: Type.Optional(Type.String({ description: "Founder name for the schema.org Person + footer. Optional." })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const p = params as { path?: string; outDir?: string; domain?: string; founder?: string };
      const r = runScaffold({ path: p.path, outDir: p.outDir, domain: p.domain, founderName: p.founder }, { builtAt: new Date().toISOString() });
      return text(r.message, r.details);
    },
  });

  // deploy: take the build output (read from build.json's publishDir) live to a
  // user-owned URL. Two models, both keeping ownership with the user and nothing
  // phoning a central account: a BYO Netlify token (NETLIFY_AUTH_TOKEN, deploys
  // into their own account via the file-digest API) or, with no token, the
  // Netlify CLI's own --allow-anonymous flow for a 1-hour claimable URL. The
  // token is read ONLY from the environment (BYOK), never passed as a parameter.
  pi.registerTool({
    name: "deploy",
    label: "Thought Layer: deploy",
    description:
      "Take the built site live to a user-owned URL. Reads build.json (publishDir/entry, and the backend block when present) next to the state file, then deploys to Netlify. " +
      "Two models, both BYOK with no lock-in: with NETLIFY_AUTH_TOKEN set (read from the environment only, never a parameter) it deploys into the user's OWN account via the file-digest API (no zip); with no token it uses the Netlify CLI's --allow-anonymous flow for an instant live URL plus a one-hour claim link. " +
      "When build.json declares a backend it ships automatically: the functions go up via the user's Netlify CLI and the declared env var names are set on the site (values read only from the environment, BYOK). DATABASE_URL is bring-your-own by default; provisionDb and applySchema are opt in. staticOnly ships just the front end. " +
      "Run the build first (thought-layer-build / tl_scaffold). Use dryRun:true to preview the file and backend plan with no network call.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "State file (or project dir) whose build.json to deploy. Defaults to ./.thought-layer/state.json; honors a named file." })),
      dryRun: Type.Optional(Type.Boolean({ description: "Plan only: walk the publish dir and report the files, target, and backend plan, with no network call or CLI spawn." })),
      anonymous: Type.Optional(Type.Boolean({ description: "Force the no-account path (Netlify CLI --allow-anonymous) even if a token is set. Default: token path when NETLIFY_AUTH_TOKEN is set, else anonymous." })),
      siteName: Type.Optional(Type.String({ description: "Create the site under this name (a-z0-9-). Omit to let Netlify assign a random subdomain." })),
      siteId: Type.Optional(Type.String({ description: "Re-deploy to an existing site id instead of creating a new one." })),
      staticOnly: Type.Optional(Type.Boolean({ description: "Ship only the front end even when build.json declares a backend." })),
      provisionDb: Type.Optional(Type.Boolean({ description: "Opt in: provision Neon with the user's own NEON_API_KEY (read from the environment). Default off, which uses a bring-your-own DATABASE_URL." })),
      applySchema: Type.Optional(Type.Boolean({ description: "Opt in: apply schema.sql with psql once the database is reachable. Default off." })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const p = params as { path?: string; dryRun?: boolean; anonymous?: boolean; siteName?: string; siteId?: string; staticOnly?: boolean; provisionDb?: boolean; applySchema?: boolean };
      const r = await runDeploy(
        { path: p.path, dryRun: p.dryRun, anonymous: p.anonymous, siteName: p.siteName, siteId: p.siteId, staticOnly: p.staticOnly, provisionDb: p.provisionDb, applySchema: p.applySchema },
        { deployedAt: new Date().toISOString() },
      );
      return text(r.message, r.details);
    },
  });
}
