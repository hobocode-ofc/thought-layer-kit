// Pure mapping from a ProgressState (+ the delivered-artifacts manifest) to a
// Notion "wiki" plan: a root page, one child page per workflow area, and an
// Artifacts database. No fetch, no fs - the notion-io layer turns this plan into
// API calls. Kept pure so the block construction and the API-limit chunking are
// unit-testable without a token.
//
// Notion API limits this encodes: rich_text content max 2000 chars (chunkRichText),
// at most 100 children per append (chunkChildren), and at most 2 levels of block
// nesting per create/append (withinDepth guards it; we keep tables/toggles to one
// nested level). Notion has no upsert, so the io layer find-or-creates by stored id.

import { computeProjection, fmtMoney, type Assumptions } from "./model.ts";
import {
  brandGuideMarkdown, requirementsMarkdown, glossaryMarkdown, swotMarkdown,
  type Brand, type Grill, type Swot, type ArtifactManifest,
} from "./artifacts.ts";
import type { ProgressState } from "./progress.ts";

// Notion's free-tier single-file upload ceiling. Larger files link to GitHub.
export const NOTION_FREE_FILE_LIMIT = 5 * 1024 * 1024;
const RICH_TEXT_MAX = 2000;
const CHILDREN_MAX = 100;

export type Annotations = Partial<Record<"bold" | "italic" | "strikethrough" | "underline" | "code", boolean>> & { color?: string };
export interface RichText { type: "text"; text: { content: string; link?: { url: string } | null }; annotations?: Annotations; }
export type Block = Record<string, unknown>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ---- rich text (with the 2000-char split) ------------------------------------

const rtSeg = (content: string, ann?: Annotations, link?: string): RichText => ({
  type: "text",
  text: { content, ...(link ? { link: { url: link } } : {}) },
  ...(ann ? { annotations: ann } : {}),
});

// Split a string into rich_text segments no longer than 2000 chars each.
export function chunkRichText(text: string, ann?: Annotations, link?: string): RichText[] {
  const s = String(text ?? "");
  if (s.length <= RICH_TEXT_MAX) return [rtSeg(s, ann, link)];
  const out: RichText[] = [];
  for (let i = 0; i < s.length; i += RICH_TEXT_MAX) out.push(rtSeg(s.slice(i, i + RICH_TEXT_MAX), ann, link));
  return out;
}

// Minimal inline markdown: **bold** and `code`. Everything else is plain text.
// Every segment is itself chunked to the 2000-char limit.
function inline(text: string): RichText[] {
  const out: RichText[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...chunkRichText(text.slice(last, m.index)));
    if (m[1] != null) out.push(...chunkRichText(m[1], { bold: true }));
    else if (m[2] != null) out.push(...chunkRichText(m[2], { code: true }));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(...chunkRichText(text.slice(last)));
  return out.length ? out : [rtSeg("")];
}

// ---- block builders ----------------------------------------------------------

const para = (text: string): Block => ({ object: "block", type: "paragraph", paragraph: { rich_text: inline(text) } });
const heading = (level: 1 | 2 | 3, text: string): Block => {
  const t = `heading_${level}`;
  return { object: "block", type: t, [t]: { rich_text: inline(text) } };
};
const bullet = (text: string): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: inline(text) } });
const numbered = (text: string): Block => ({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: inline(text) } });
const quote = (text: string): Block => ({ object: "block", type: "quote", quote: { rich_text: inline(text) } });
const callout = (text: string, emoji = "💡"): Block => ({ object: "block", type: "callout", callout: { rich_text: inline(text), icon: { type: "emoji", emoji } } });
const divider = (): Block => ({ object: "block", type: "divider", divider: {} });
const codeBlock = (text: string, language = "plain text"): Block => ({ object: "block", type: "code", code: { rich_text: chunkRichText(text), language } });
export const bookmark = (url: string): Block => ({ object: "block", type: "bookmark", bookmark: { url } });
export const externalImage = (url: string): Block => ({ object: "block", type: "image", image: { type: "external", external: { url } } });

function table(headers: string[], rows: string[][]): Block {
  const toRow = (cells: string[]): Block => ({ object: "block", type: "table_row", table_row: { cells: cells.map((c) => chunkRichText(c)) } });
  return {
    object: "block",
    type: "table",
    table: { table_width: headers.length, has_column_header: true, has_row_header: false, children: [toRow(headers), ...rows.map(toRow)] },
  };
}

// ---- markdown -> blocks (the workhorse; all artifacts are markdown) ----------

export function markdownToBlocks(md: string): Block[] {
  const lines = String(md ?? "").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const t = raw.trim();
    if (t.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) { buf.push(lines[i] ?? ""); i++; }
      i++; // skip closing fence
      out.push(codeBlock(buf.join("\n")));
      continue;
    }
    if (!t) { i++; continue; }
    if (t === "---" || t === "***" || t === "___") { out.push(divider()); i++; continue; }
    const mh = t.match(/^(#{1,6})\s+(.*)$/);
    if (mh) { out.push(heading(Math.min(3, mh[1]!.length) as 1 | 2 | 3, mh[2]!)); i++; continue; }
    if (t.startsWith("> ")) { out.push(quote(t.slice(2))); i++; continue; }
    const mb = t.match(/^[-*]\s+(.*)$/);
    if (mb) { out.push(bullet(mb[1]!)); i++; continue; }
    const mn = t.match(/^\d+\.\s+(.*)$/);
    if (mn) { out.push(numbered(mn[1]!)); i++; continue; }
    out.push(para(t));
    i++;
  }
  return out;
}

// ---- API-limit helpers (unit-tested) -----------------------------------------

// Split a children array into <=100-block append batches.
export function chunkChildren(blocks: Block[], size = CHILDREN_MAX): Block[][] {
  const out: Block[][] = [];
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
  return out.length ? out : [[]];
}

// True when no block nests deeper than maxDepth levels (Notion allows 2 per
// create/append). We keep tables/toggles to a single nested level, so this holds.
export function withinDepth(blocks: Block[], maxDepth = 2): boolean {
  const depth = (bs: Block[], d: number): number => {
    let max = d;
    for (const b of bs) {
      const t = b["type"] as string;
      const inner = (obj(b[t])["children"]) as Block[] | undefined;
      if (Array.isArray(inner) && inner.length) max = Math.max(max, depth(inner, d + 1));
    }
    return max;
  };
  return depth(blocks, 1) <= maxDepth;
}

// ---- artifact references (link vs upload decision) ---------------------------

export function artifactCategory(path: string): string {
  if (path.startsWith("Brand/")) return "Brand";
  if (path.startsWith("Deploy/")) return "Deploy";
  if (path.startsWith("LandingPage/")) return "Landing";
  if (path.endsWith(".svg")) return "Infographic";
  if (path === "BuildPrompt.md") return "Build prompt";
  return "Doc";
}

// Decide how an artifact appears in the wiki: upload to Notion when small enough
// and an uploadable type, else link to its GitHub copy.
export function artifactRef(bytes: number, hasGithubUrl: boolean): "upload" | "link" {
  return bytes <= NOTION_FREE_FILE_LIMIT && !hasGithubUrl ? "upload" : hasGithubUrl ? "link" : "upload";
}

// ---- the wiki plan -----------------------------------------------------------

export interface WikiArtifact { name: string; path: string; category: string; bytes: number; url?: string; }
export interface WikiArea { key: string; title: string; emoji: string; blocks: Block[]; }
export interface WikiPlan { title: string; icon: string; overview: Block[]; areas: WikiArea[]; artifacts: WikiArtifact[]; }

export interface WikiBuildOptions {
  manifest?: ArtifactManifest | null;
  urls?: Record<string, string>; // artifact relpath -> GitHub blob URL
}

// The 8 workflow areas, in order, with their emoji.
export const WIKI_AREAS: Array<{ key: string; title: string; emoji: string }> = [
  { key: "big-idea", title: "The Big Idea", emoji: "💡" },
  { key: "business-model", title: "Business Model", emoji: "💰" },
  { key: "brand", title: "Brand", emoji: "🎨" },
  { key: "market-research", title: "Market Research", emoji: "📊" },
  { key: "strategy", title: "Strategy", emoji: "📈" },
  { key: "product", title: "Product (PRD)", emoji: "📋" },
  { key: "decision-science", title: "Decision Science", emoji: "⚖️" },
  { key: "library", title: "Library", emoji: "📚" },
];

export function buildWikiPlan(state: ProgressState, opts: WikiBuildOptions = {}): WikiPlan {
  const answers = obj(state.answers);
  const brand = (state.brand && typeof state.brand === "object" ? state.brand : null) as Brand | null;
  const guide = brand?.guide || null;
  const grill = (state.grill && typeof state.grill === "object" ? state.grill : null) as Grill | null;
  const swot = (state.swot && typeof state.swot === "object" ? state.swot : null) as Swot | null;
  const prd = obj(state.prd);
  const bizModel = obj(state.bizModel);
  const research = obj(state.research);
  const assumptions = (bizModel["assumptions"] || null) as Assumptions | null;
  const brandName = str(guide?.brandName) || "Your Product";
  const oneLiner = str(answers["what-statement"]) || str(answers["pitch"]) || str(guide?.positioning);

  const overview: Block[] = [];
  if (oneLiner) overview.push(callout(oneLiner, "💡"));
  overview.push(para("This private workspace was generated by The Thought Layer. Each section below is a page; the Artifacts database links the files delivered to your repo."));

  const areaBlocks: Record<string, Block[]> = {};

  // Big idea: the one-liner, positioning, and the press release if present.
  {
    const b: Block[] = [];
    if (oneLiner) b.push(heading(2, "What it is"), callout(oneLiner, "🎯"));
    if (guide?.positioning) b.push(heading(2, "Who it is for"), para(guide.positioning));
    const press = str(answers["press-release"]);
    if (press) b.push(heading(2, "The press release"), ...markdownToBlocks(press));
    areaBlocks["big-idea"] = b;
  }

  // Business model: a parties table + the projection summary.
  {
    const b: Block[] = [];
    const proj = computeProjection(assumptions);
    if (proj && assumptions) {
      const s = proj.summary;
      const cur = assumptions.currency || "USD";
      b.push(heading(2, "The numbers"));
      b.push(callout(
        `Year 1 revenue ${fmtMoney(s.year1Revenue, cur)}. Monthly break-even ${s.breakEvenMonth ? `month ${s.breakEvenMonth}` : "beyond horizon"}. Max cash drawdown ${fmtMoney(s.maxDrawdown, cur)}. MRR at month ${s.horizon} is ${fmtMoney(s.endingMRR, cur)}.`,
        "💰",
      ));
      const rows = (assumptions.parties || []).slice(0, 12).map((p) => [
        str(p.name) || p.id, str(p.role), String(p.startingCount ?? ""), String(p.monthlyNewBase ?? ""),
        `${p.monthlyChurnPct ?? 0}%`, fmtMoney(Number(p.revenuePerUnitPerMonth) || 0, cur), fmtMoney(Number(p.cacPerUnit) || 0, cur),
      ]);
      b.push(heading(2, "Parties"), table(["Party", "Role", "Start", "New/mo", "Churn", "Rev/unit/mo", "CAC"], rows));
      if (assumptions.narrative) b.push(heading(2, "Notes"), para(assumptions.narrative));
    }
    areaBlocks["business-model"] = b;
  }

  // Brand: the style guide rendered natively, plus a palette table.
  {
    const b: Block[] = [];
    if (guide) {
      b.push(...markdownToBlocks(brandGuideMarkdown(guide)));
      const pal = (guide.palette || []).filter((p) => p?.hex);
      if (pal.length) b.push(heading(2, "Palette"), table(["Color", "Hex", "Role"], pal.map((p) => [str(p.name), str(p.hex), str(p.role)])));
    }
    areaBlocks["brand"] = b;
  }

  // Market research.
  {
    const b: Block[] = [];
    const brief = str(research["brief"]);
    if (brief) {
      const desc = str(research["description"]);
      if (desc) b.push(callout(desc, "📊"));
      b.push(...markdownToBlocks(brief));
    }
    areaBlocks["market-research"] = b;
  }

  // Strategy: the SWOT.
  {
    const b: Block[] = [];
    const hasSwot = !!swot && Object.values(swot).some((v) => Array.isArray(v) && v.some((x) => x && String(x).trim()));
    if (hasSwot) b.push(...markdownToBlocks(swotMarkdown(swot)));
    areaBlocks["strategy"] = b;
  }

  // Product: the PRD, requirements, and glossary.
  {
    const b: Block[] = [];
    const prdMd = str(prd["markdown"]);
    if (prdMd) b.push(...markdownToBlocks(prdMd));
    if (grill?.requirements?.length) { b.push(divider()); b.push(...markdownToBlocks(requirementsMarkdown(grill))); }
    if (grill?.glossary?.length) { b.push(divider()); b.push(...markdownToBlocks(glossaryMarkdown(grill))); }
    areaBlocks["product"] = b;
  }

  // Decision science: any dq-* / decision-* answers.
  {
    const b: Block[] = [];
    const dq = Object.keys(answers).filter((k) => /^(dq|decision)/i.test(k) && str(answers[k]).trim());
    if (dq.length) { b.push(heading(2, "Decision records")); for (const k of dq) b.push(bullet(`**${k}**: ${str(answers[k])}`)); }
    areaBlocks["decision-science"] = b;
  }

  // Library: no structured data in state; left empty (the io layer skips empties).
  areaBlocks["library"] = [];

  const areas: WikiArea[] = WIKI_AREAS
    .map((a) => ({ ...a, blocks: areaBlocks[a.key] || [] }))
    .filter((a) => a.blocks.length > 0);

  // Artifacts for the database: skip the landing-page SEO sidecars (keep only
  // index.html), keep everything else.
  const urls = opts.urls || {};
  const files = opts.manifest?.files || [];
  const artifacts: WikiArtifact[] = files
    .filter((f) => !(f.path.startsWith("LandingPage/") && f.path !== "LandingPage/index.html"))
    .map((f) => ({ name: f.path, path: f.path, category: artifactCategory(f.path), bytes: f.bytes, ...(urls[f.path] ? { url: urls[f.path] } : {}) }));

  return { title: `${brandName} workspace`, icon: "🚀", overview, areas, artifacts };
}
