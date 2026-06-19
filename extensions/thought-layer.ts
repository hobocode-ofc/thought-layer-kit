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
  applyStateOp, runScaffold, runDeploy, runSync, runArtifacts, runWiki,
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

  // tl_sync: store and sync session files in the user's OWN private GitHub repo.
  // Git is transport + history + multi-user; the kit reconciles concurrent edits
  // itself. Collaboration is granted on GitHub (the kit never changes permissions).
  pi.registerTool({
    name: "tl_sync",
    label: "Thought Layer: sync sessions",
    description:
      "Store and sync your Thought Layer session files in your OWN private GitHub repo (BYOK, no central account). " +
      "ops: init (set a repo as a sessions workspace), save (snapshot the current state as a named session, commit, push), list, open (pull and resume a session), pull (reconcile remote edits), push, status. " +
      "Each session is one .thought-layer/<name>.json in the repo; save prompts you for a human name. Git carries history and multi-user; the kit reconciles concurrent edits itself (newest wins per field, conflicts reported), so it never hand-merges JSON. " +
      "Collaboration is granted on GitHub: you add collaborators to the repo, the kit never changes permissions. Needs git installed (gh optional, used to create a repo).",
    parameters: Type.Object({
      op: Type.String({ description: "init | save | list | open | pull | push | status" }),
      name: Type.Optional(Type.String({ description: "Session name (save/open) or workspace label (init). A human name, slugged to <name>.json." })),
      repo: Type.Optional(Type.String({ description: "init only: the private GitHub repo to use (owner/name or a URL)." })),
      dir: Type.Optional(Type.String({ description: "Explicit clone dir for the workspace (overrides the configured one)." })),
      workspace: Type.Optional(Type.String({ description: "Select an existing workspace by its label." })),
      message: Type.Optional(Type.String({ description: "Commit message for save/push." })),
      noPush: Type.Optional(Type.Boolean({ description: "save/push: commit locally without pushing." })),
      path: Type.Optional(Type.String({ description: "save: the current working state file to snapshot (defaults to the session default)." })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const p = params as { op: string; name?: string; repo?: string; dir?: string; workspace?: string; message?: string; noPush?: boolean; path?: string };
      const r = await runSync(
        { op: p.op, name: p.name, repo: p.repo, dir: p.dir, workspace: p.workspace, message: p.message, noPush: p.noPush, path: p.path },
        { ts: Date.now(), exportedAt: new Date().toISOString() },
      );
      return text(r.message, r.details);
    },
  });

  // tl_artifacts: generate the full deliverable bundle from a session (PRD,
  // requirements, glossary, build prompt, brand guide + look book + logo, SWOT
  // and business-model infographics, market research, a landing page) plus any
  // on-disk build/deploy provenance, and deliver it to the user's OWN private
  // sessions repo under artifacts/<session>/ via the sync git plumbing.
  pi.registerTool({
    name: "tl_artifacts",
    label: "Thought Layer: deliver artifacts",
    description:
      "Generate the full asset bundle for a session and deliver it to your OWN private sessions repo (the one tl_sync set up), under artifacts/<session>/. " +
      "Builds, from the saved state: PRD.md, Requirements.md, DomainGlossary.md, BuildPrompt.md, the brand style guide + LookBook.html + Logo.svg, SWOT.svg and BusinessModel.svg infographics, MarketResearch.md, and a deployable landing page; it also copies any on-disk build/deploy provenance (build.json, deploy.json, BACKEND/TRACEABILITY/DECISIONS.md, schema.sql, netlify.toml) into a Deploy/ folder, and writes an artifacts.json manifest the wiki reads. " +
      "Force-adds past the sessions .gitignore, commits, and pushes (newest delivery wins; artifacts are not field-merged). Pass name to pick the session; noDeliver writes locally without committing. Needs a sessions workspace (tl_sync init) first.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Session name whose artifacts to deliver (defaults to the workspace's active session)." })),
      workspace: Type.Optional(Type.String({ description: "Select an existing sessions workspace by label." })),
      path: Type.Optional(Type.String({ description: "Explicit source state file to read (defaults to the session file in the clone)." })),
      dir: Type.Optional(Type.String({ description: "Explicit clone dir for the workspace (overrides the configured one)." })),
      message: Type.Optional(Type.String({ description: "Commit message for the delivery." })),
      noPush: Type.Optional(Type.Boolean({ description: "Commit locally without pushing." })),
      noDeliver: Type.Optional(Type.Boolean({ description: "Write the bundle into the clone but do not commit or push." })),
      domain: Type.Optional(Type.String({ description: "Real domain for the landing page (canonical/OG)." })),
      founder: Type.Optional(Type.String({ description: "Founder name for the landing page." })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const p = params as { name?: string; workspace?: string; path?: string; dir?: string; message?: string; noPush?: boolean; noDeliver?: boolean; domain?: string; founder?: string };
      const r = runArtifacts(
        { name: p.name, workspace: p.workspace, path: p.path, dir: p.dir, message: p.message, noPush: p.noPush, noDeliver: p.noDeliver, domain: p.domain, founderName: p.founder },
        { generatedAt: new Date().toISOString() },
      );
      return text(r.message, r.details);
    },
  });

  // tl_wiki: build/refresh a PRIVATE Notion wiki (an internal intranet) from the
  // session + the delivered artifacts. Notion is private by default, so the docs
  // are behind the user's own auth. BYOK: the token is read from the environment
  // only; the parent page (shared with the integration) is passed as an id/url.
  pi.registerTool({
    name: "tl_wiki",
    label: "Thought Layer: Notion wiki",
    description:
      "Build or refresh a PRIVATE Notion wiki (an internal intranet) for a session: a root page, one child page per workflow area (Big Idea, Business Model, Brand, Market Research, Strategy, PRD, Decision Science), rendered natively in Notion, plus an Artifacts database that links the files delivered by tl_artifacts. " +
      "Notion pages are private to the user's workspace, so this satisfies an auth requirement with no public exposure. BYOK: the integration token is read ONLY from THOUGHT_LAYER_NOTION_TOKEN (or NOTION_TOKEN) in the environment, never a parameter. Setup once: create an internal integration at notion.so/my-integrations, set the token, share a page with the integration, and pass that page as parentPage. " +
      "Idempotent: it stores the page ids locally and refreshes content on re-run; replace recreates the wiki from scratch; dryRun reports the plan with no network call. Run tl_artifacts first so the Artifacts database has GitHub links.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Session name to publish (defaults to the workspace's active session)." })),
      parentPage: Type.Optional(Type.String({ description: "Notion page id or URL the integration is shared with (where the wiki root is created). Or set THOUGHT_LAYER_NOTION_PARENT." })),
      workspace: Type.Optional(Type.String({ description: "Select an existing sessions workspace by label." })),
      path: Type.Optional(Type.String({ description: "Explicit source state file (defaults to the session file in the clone)." })),
      dir: Type.Optional(Type.String({ description: "Explicit clone dir for the workspace." })),
      replace: Type.Optional(Type.Boolean({ description: "Recreate the wiki from scratch (new pages) instead of refreshing the existing one." })),
      dryRun: Type.Optional(Type.Boolean({ description: "Build the plan and report area/block/artifact counts with no network call." })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const p = params as { name?: string; parentPage?: string; workspace?: string; path?: string; dir?: string; replace?: boolean; dryRun?: boolean };
      const r = await runWiki({ name: p.name, parentPage: p.parentPage, workspace: p.workspace, path: p.path, dir: p.dir, replace: p.replace, dryRun: p.dryRun });
      return text(r.message, r.details);
    },
  });
}
