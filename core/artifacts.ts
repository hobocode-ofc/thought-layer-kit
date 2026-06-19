// Pure artifact generation: from a ProgressState, produce the full "startup kit"
// of deliverables as an in-memory file map (path -> text), mirroring the web
// app's src/lib/exports.js. No node:, no fetch, no DOM - the artifacts-io layer
// writes the map to disk and delivers it to GitHub, and the notion layer reads
// the manifest to lay out the wiki.
//
// The pure markdown generators are ported dash-free (the kit's copy rule: no
// em-dash, en-dash, or spaced hyphen in generated prose, see backend.ts). The
// HTML look book and the SVG infographics are ported faithfully (they are markup
// + visual copy, exactly as scaffold.ts emits HTML); the dash-free unit test
// covers only the markdown outputs.
//
// The heavy Office binaries (.pptx deck, .xlsx workbook) are intentionally NOT
// here: they need large non-pure deps and their content already ships as an SVG
// infographic + markdown. See the plan's Phase 3.

import { computeProjection, fmtMoney, type Assumptions } from "./model.ts";
import { extractScaffoldSpec, buildStarterSite } from "./scaffold.ts";
import type { ProgressState } from "./progress.ts";

// ---- consumed state shapes (permissive; everything optional) -----------------

export interface BrandGuide {
  brandName?: string;
  tagline?: string;
  positioning?: string;
  personality?: string[];
  voice?: { tone?: string; dos?: string[]; donts?: string[] };
  palette?: Array<{ name?: string; hex?: string; role?: string }>;
  typography?: {
    display?: { family?: string; weights?: string; usage?: string };
    body?: { family?: string; weights?: string; usage?: string };
  };
  logoDirection?: string;
  imagery?: string;
  messaging?: string[];
}
export interface Brand {
  guide?: BrandGuide;
  logos?: Array<{ id?: string; label?: string; rationale?: string; svg?: string }>;
  chosenLogoId?: string;
}
export interface Grill {
  glossary?: Array<{ term?: string; definition?: string }>;
  requirements?: Array<{ id?: string; category?: string; text?: string; statement?: string }>;
}
export interface Swot {
  strengths?: string[];
  weaknesses?: string[];
  opportunities?: string[];
  threats?: string[];
}
export interface Governance {
  jurisdiction?: string;
  entityType?: string;
  sector?: string;
  report?: string; // the researched GRC + licensing + tax markdown report
  sources?: string[];
  generatedAt?: string;
}

// ---- small narrow helpers (mirror scaffold.ts) -------------------------------

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fam = (f: string): string => String(f).trim().replace(/\s+/g, "+");

// ---- brand tokens + svg font block (ported from exports.js) ------------------

export interface BrandTokens {
  primary: string;
  accent: string;
  ink: string;
  surface: string;
  muted: string;
  display: string;
  body: string;
}

export function brandTokens(guide: BrandGuide | null | undefined): BrandTokens | null {
  if (!guide || !Array.isArray(guide.palette) || !guide.palette.length) return null;
  const role = (re: string, fb: string): string =>
    guide.palette!.find((p) => p?.name && new RegExp(re, "i").test(p.name))?.hex || fb;
  return {
    primary: role("primary", guide.palette[0]?.hex || "#1f3a5f"),
    accent: role("accent|secondary", guide.palette[1]?.hex || "#e8743b"),
    ink: role("ink|text|dark|black", "#16202b"),
    surface: role("surface|background|light|paper|off.?white|cream", "#f7f8fa"),
    muted: role("muted|gray|grey|neutral|border", "#8a9099"),
    display: guide.typography?.display?.family || "Inter",
    body: guide.typography?.body?.family || "Inter",
  };
}

const SVG_FONTS = `<style><![CDATA[@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');.s{font-family:'Inter',system-ui,sans-serif}.d{font-family:'Inter',system-ui,sans-serif}.m{font-family:'IBM Plex Mono',ui-monospace,monospace}]]></style>`;

function svgFontBlock(t: BrandTokens | null): { style: string; disp: string } {
  if (!t) return { style: SVG_FONTS, disp: "d" };
  const style = `<style><![CDATA[@import url('https://fonts.googleapis.com/css2?family=${fam(t.display)}:wght@600;700;800&family=${fam(t.body)}:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');.s{font-family:'${t.body}',system-ui,sans-serif}.d{font-family:'${t.display}','${t.body}',sans-serif}.m{font-family:'IBM Plex Mono',ui-monospace,monospace}]]></style>`;
  return { style, disp: "d" };
}

// Greedy word-wrap for SVG text (SVG never auto-wraps). Estimates Inter advance
// at ~0.54em. Over-long words break with a trailing hyphen (a word break, not a
// banned spaced dash).
function wrapText(text: string, maxWidthPx: number, fontSizePx: number, avg = 0.54): string[] {
  const maxChars = Math.max(6, Math.floor(maxWidthPx / (fontSizePx * avg)));
  const out: string[] = [];
  let line = "";
  for (let word of String(text).trim().split(/\s+/)) {
    while (word.length > maxChars) {
      if (line) { out.push(line); line = ""; }
      out.push(word.slice(0, maxChars - 1) + "-");
      word = word.slice(maxChars - 1);
    }
    const test = line ? line + " " + word : word;
    if (test.length > maxChars && line) { out.push(line); line = word; }
    else line = test;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

// ---- markdown artifacts (dash-free) ------------------------------------------

export function glossaryMarkdown(grill: Grill | null | undefined): string {
  const terms = grill?.glossary || [];
  return `# Domain Glossary\n\n${terms.map((g) => `- **${g.term}**: ${g.definition}`).join("\n")}\n`;
}

const REQ_CATS = ["persona", "journey", "ux", "functional", "business-rule", "data", "integration", "non-functional", "metric"];

export function requirementsMarkdown(grill: Grill | null | undefined): string {
  const reqs = (grill?.requirements || []).map((r) => ({
    id: r.id || "",
    category: r.category || "functional",
    text: r.text ?? r.statement ?? "",
  }));
  let md = "# Requirements\n";
  for (const cat of REQ_CATS) {
    const inCat = reqs.filter((r) => r.category === cat);
    if (!inCat.length) continue;
    md += `\n## ${cat.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())}\n\n`;
    md += inCat.map((r) => `- **${r.id}** ${r.text}`).join("\n") + "\n";
  }
  return md;
}

export function swotMarkdown(swot: Swot | null | undefined): string {
  if (!swot) return "";
  const quads: Array<[keyof Swot, string]> = [
    ["strengths", "Strengths"], ["weaknesses", "Weaknesses"],
    ["opportunities", "Opportunities"], ["threats", "Threats"],
  ];
  let md = "# SWOT Analysis\n";
  for (const [k, label] of quads) {
    const items = (swot[k] || []).filter((x) => x && x.trim());
    md += `\n## ${label}\n\n${items.length ? items.map((i) => `- ${i}`).join("\n") : "_(none)_"}\n`;
  }
  return md;
}

export function brandGuideMarkdown(guide: BrandGuide | null | undefined): string {
  if (!guide) return "";
  const pal = (guide.palette || []).map((p) => `- **${p.name}** \`${p.hex}\` (${p.role})`).join("\n");
  const msg = (guide.messaging || []).map((m) => `- ${m}`).join("\n");
  const dos = (guide.voice?.dos || []).map((d) => `- ${d}`).join("\n");
  const donts = (guide.voice?.donts || []).map((d) => `- ${d}`).join("\n");
  const disp = guide.typography?.display;
  const body = guide.typography?.body;
  return `# Brand Style Guide: ${guide.brandName || ""}

> ${guide.tagline || ""}

**Positioning.** ${guide.positioning || ""}

**Personality.** ${(guide.personality || []).join(", ")}

## Voice and Tone
${guide.voice?.tone || ""}

**Do**
${dos || "- (none)"}

**Don't**
${donts || "- (none)"}

## Color Palette
${pal || "- (none)"}

## Typography
- **Display:** ${disp?.family || ""} (${disp?.weights || ""}). Usage: ${disp?.usage || ""}
- **Body:** ${body?.family || ""} (${body?.weights || ""}). Usage: ${body?.usage || ""}

## Logo Direction
${guide.logoDirection || ""}

## Imagery and Iconography
${guide.imagery || ""}

## Messaging Examples
${msg || "- (none)"}
`;
}

// ---- the build-kit prompt (dash-free) ----------------------------------------

// Set-aside to-dos, grouped by question id (the kit has no section catalog, so
// it groups by qId rather than the web app's section title).
function collectTodos(feedback: Record<string, unknown>): Array<{ qId: string; summaries: string[] }> {
  const out: Array<{ qId: string; summaries: string[] }> = [];
  for (const [qId, v] of Object.entries(feedback || {})) {
    const todos = (v as { todos?: Array<{ summary?: string }> } | null)?.todos;
    if (todos?.length) out.push({ qId, summaries: todos.map((t) => t.summary || "to-do") });
  }
  return out;
}

const SEO_DEPLOY_SECTION = `## Discoverability and SEO (required)
Build the product so both people and AI assistants can find and trust it. Implement all of the following:
- Structured data: add schema.org JSON-LD as one linked @graph. Always include an Organization and a Person (the founder), cross-referenced (Organization.founder and Person.worksFor) and each with a sameAs array pointing to real profiles. Add a WebSite node and the type that matches the page (WebPage, SoftwareApplication, or Product). Add FAQPage wherever there is an FAQ, HowTo for any step-by-step process, BreadcrumbList on every real sub-page, and Article or BlogPosting on real article pages. Never add a schema type that does not match visible on-page content.
- llms.txt: create /llms.txt at the site root with an H1 title, a one-paragraph summary in a blockquote, sections that link the key pages, and a short FAQ, so AI crawlers can extract what the site is and does.
- sitemap.xml listing every real page, and robots.txt that allows crawling and points to the sitemap.
- A canonical link on every page.
- Open Graph and Twitter Card meta on every page, plus a 1200x630 social image.
- Semantic, accessible HTML: landmark elements, headings in order, alt text on images, labelled form controls, and a visible focus style.
- An SEO README at SEO.md that documents every item above: where each lives and how to update it later (especially the Organization and Person sameAs links and the social image).

## Deployment (Netlify recommended)
Netlify is the simplest way to ship this. Include what it needs and give the founder a paste-ready deploy path:
- Add a netlify.toml with the build command and publish directory. For a single-page app, add a SPA redirect (/* to /index.html with status 200).
- Document two deploy options in SEO.md or a DEPLOY.md:
  1. Continuous deploy: push the repo to GitHub and connect it at app.netlify.com, so every push to the main branch deploys automatically.
  2. CLI deploy: run the build, then "npx netlify-cli deploy --prod --dir <publish-directory>".
- Make sure llms.txt, robots.txt, sitemap.xml, and the social image sit in the publish directory so they are served at the site root.
`;

export function buildKitPrompt(
  grill: Grill | null | undefined,
  prdMarkdown: string,
  assumptions: Assumptions | null | undefined,
  brand: Brand | null | undefined,
  feedback: Record<string, unknown> = {},
): string {
  const projection = assumptions ? computeProjection(assumptions) : null;
  let bizSummary = "";
  if (projection && assumptions) {
    const s = projection.summary;
    bizSummary = `Business model: ${(assumptions.parties || []).map((p) => `${p.name} (${p.role})`).join(", ")}. Monthly break-even at month ${s.breakEvenMonth ?? "beyond horizon"}; cumulative break-even at month ${s.cumBreakEvenMonth ?? "beyond horizon"}; year-1 revenue about ${fmtMoney(s.year1Revenue, assumptions.currency)}; max cash drawdown about ${fmtMoney(Math.abs(s.maxDrawdown), assumptions.currency)}.`;
  }
  const groups = collectTodos(feedback);
  const todoBlock = groups.length
    ? `\n## Open validation to-dos (the founder set these aside; treat as known gaps, not blockers)\n${groups.map((g) => `- ${g.qId}: ${g.summaries.join("; ")}`).join("\n")}\n`
    : "";
  const hasGuide = !!brand?.guide;
  return `# Build This Product

You are an expert full-stack engineering agent. Build version 1 of the product specified below. Work iteratively: scaffold, implement the critical user journeys first, then the remaining requirements. Ask nothing; every decision you need is in this document, and where genuinely unspecified, choose the simplest option consistent with the PRD and note it in a DECISIONS.md.

## Ground rules
- Honor the Domain Glossary exactly: use its terms for entities, fields, and UI labels (ubiquitous language).
- Every requirement has an ID (R-1, R-2, ...). Track them in a TRACEABILITY.md mapping requirement to implementation to test.
- Respect the "Out of Scope" list absolutely. Do not build excluded features.
- Mobile and desktop must both work.${hasGuide ? "\n- Apply the brand identity in the Brand section below to all UI, copy, color, and type, and to any generated assets." : ""}
${bizSummary ? `\n## Business context\n${bizSummary}\n` : ""}${hasGuide ? `\n## Brand identity (apply consistently)\n${brandGuideMarkdown(brand!.guide)}\n(The kit also includes Logo.svg and a rendered LookBook.html.)\n` : ""}${todoBlock}
${SEO_DEPLOY_SECTION}
---

${prdMarkdown || "(PRD not yet composed; generate the PRD first)"}

---

${requirementsMarkdown(grill)}

---

${glossaryMarkdown(grill)}
`;
}

// ---- SWOT infographic (SVG, ported faithfully) -------------------------------

export function swotInfographicSvg(swot: Swot | null | undefined, brand: Brand | null | undefined): string {
  const t = brandTokens(brand?.guide);
  const { style: fontStyle, disp } = svgFontBlock(t);
  const surface = t?.surface || "#f7f8fa";
  const ink = t?.ink || "#0f1729";

  const W = 1000, spineX = W / 2, R = 34, LH = 19, FS = 13.5;
  const headerH = 104, footerH = 42, gapRow = 26;
  const PANEL = { L: { x: 28, w: 444 }, R: { x: 528, w: 444 } };
  const textW = 360;

  const quads = [
    { key: "strengths" as const, label: "STRENGTHS", color: "#059669", icon: "up", side: -1, row: 0 },
    { key: "weaknesses" as const, label: "WEAKNESSES", color: "#dc2626", icon: "down", side: -1, row: 1 },
    { key: "opportunities" as const, label: "OPPORTUNITIES", color: "#4f46e5", icon: "search", side: 1, row: 0 },
    { key: "threats" as const, label: "THREATS", color: "#d97706", icon: "warn", side: 1, row: 1 },
  ].map((q) => ({
    ...q,
    items: ((swot?.[q.key] || []) as string[]).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8).map((s) => wrapText(s, textW, FS)),
  }));

  const bulletsH = (q: typeof quads[number]) => (q.items.length ? q.items.reduce((a, lines) => a + lines.length * LH + 10, 0) : 26);
  const quadH = (q: typeof quads[number]) => 94 + bulletsH(q) + 14;
  const rowH = [Math.max(quadH(quads[0]!), quadH(quads[2]!)), Math.max(quadH(quads[1]!), quadH(quads[3]!))];
  const rowY = [headerH + gapRow, 0];
  rowY[1] = rowY[0]! + rowH[0]! + gapRow;
  const footerTop = rowY[1]! + rowH[1]! + gapRow;
  const H = footerTop + footerH;

  const icon = (type: string, cx: number, cy: number): string => {
    const P = (d: string, w = 5) => `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (type === "up") return P(`M${cx} ${cy + 13} L${cx} ${cy - 13} M${cx - 9} ${cy - 4} L${cx} ${cy - 13} L${cx + 9} ${cy - 4}`);
    if (type === "down") return P(`M${cx} ${cy - 13} L${cx} ${cy + 13} M${cx - 9} ${cy + 4} L${cx} ${cy + 13} L${cx + 9} ${cy + 4}`);
    if (type === "search") return `<circle cx="${cx - 3}" cy="${cy - 3}" r="9.5" fill="none" stroke="#ffffff" stroke-width="4.5"/>` + P(`M${cx + 4} ${cy + 4} L${cx + 13} ${cy + 13}`);
    return P(`M${cx} ${cy - 15} L${cx + 15} ${cy + 12} L${cx - 15} ${cy + 12} Z`, 4.5) +
      `<rect x="${cx - 2.5}" y="${cy - 6}" width="5" height="11" rx="2.5" fill="#ffffff"/><circle cx="${cx}" cy="${cy + 9}" r="2.7" fill="#ffffff"/>`;
  };

  const quadrant = (q: typeof quads[number]): string => {
    const pan = q.side < 0 ? PANEL.L : PANEL.R;
    const top = rowY[q.row]!, rh = rowH[q.row]!;
    const my = top + 40;
    const mx = spineX + q.side * 70;
    const innerEdge = mx - q.side * R;
    const textX = pan.x + 42, dotX = pan.x + 26;

    let b = `<rect x="${pan.x}" y="${top + 10}" width="${pan.w}" height="${rh - 10}" rx="18" fill="${q.color}" opacity="0.06"/>`;
    b += `<rect x="${pan.x}" y="${top + 10}" width="${pan.w}" height="${rh - 10}" rx="18" fill="none" stroke="${q.color}" stroke-opacity="0.18"/>`;
    b += `<line x1="${spineX}" y1="${my}" x2="${innerEdge}" y2="${my}" stroke="${q.color}" stroke-width="2.5"/>`;
    b += `<circle cx="${spineX}" cy="${my}" r="4.5" fill="${q.color}"/>`;
    b += `<circle cx="${mx}" cy="${my}" r="${R + 6}" fill="${q.color}" opacity="0.15"/>`;
    b += `<circle cx="${mx}" cy="${my}" r="${R}" fill="${q.color}"/>`;
    b += icon(q.icon, mx, my);
    const tabW = Math.round(q.label.length * 8.6) + 30, tabH = 34, tabY = my - tabH / 2;
    const tabX = q.side < 0 ? mx - R - 12 - tabW : mx + R + 12;
    b += `<rect x="${tabX}" y="${tabY}" width="${tabW}" height="${tabH}" rx="8" fill="${q.color}"/>`;
    b += `<text class="${disp}" x="${tabX + tabW / 2}" y="${tabY + 22}" text-anchor="middle" font-size="13.5" font-weight="700" letter-spacing="1.5" fill="#ffffff">${esc(q.label)}</text>`;
    let y = top + 94;
    if (!q.items.length) return b + `<text class="s" x="${textX}" y="${y}" font-size="13" fill="#9ca3af">(none yet)</text>`;
    for (const lines of q.items) {
      b += `<circle cx="${dotX}" cy="${y - 4}" r="3" fill="${q.color}"/>`;
      b += `<text class="s" x="${textX}" y="${y}" font-size="13.5" fill="#374151">` +
        lines.map((ln, i) => `<tspan x="${textX}"${i ? ` dy="${LH}"` : ""}>${esc(ln)}</tspan>`).join("") + `</text>`;
      y += lines.length * LH + 10;
    }
    return b;
  };

  let body = `<rect width="${W}" height="${H}" fill="${surface}"/>`;
  body += `<line x1="${spineX}" y1="${headerH}" x2="${spineX}" y2="${footerTop}" stroke="#cfd5de" stroke-width="2"/>`;
  body += quads.map(quadrant).join("");
  body += `<rect x="0" y="0" width="${W}" height="${headerH}" fill="${ink}"/>`;
  body += `<text class="m" x="40" y="38" font-size="11" letter-spacing="3" fill="#ffffff" fill-opacity="0.5">THE THOUGHT LAYER</text>`;
  body += `<text class="m" x="${W - 40}" y="38" font-size="11" letter-spacing="3" fill="#ffffff" fill-opacity="0.5" text-anchor="end">STRATEGY</text>`;
  body += `<text class="${disp}" x="${spineX}" y="74" font-size="46" font-weight="700" letter-spacing="6" fill="#ffffff" text-anchor="middle">SWOT ANALYSIS</text>`;
  body += `<rect x="0" y="${footerTop}" width="${W}" height="${footerH}" fill="${ink}"/>`;
  body += `<text class="m" x="${spineX}" y="${footerTop + 26}" font-size="11" fill="#ffffff" fill-opacity="0.55" text-anchor="middle">The Thought Layer, generated locally</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${fontStyle}${body}</svg>`;
}

// ---- business model infographic (SVG, ported faithfully) ---------------------

export function bizModelInfographicSvg(assumptions: Assumptions | null | undefined, brand: Brand | null | undefined): string | null {
  const projection = computeProjection(assumptions);
  if (!projection || !assumptions) return null;
  const s = projection.summary;
  const cur = assumptions.currency || "USD";
  const t = brandTokens(brand?.guide);
  const { style: fontStyle, disp } = svgFontBlock(t);
  const surface = t?.surface || "#f7f8fa";
  const ink = t?.ink || "#0f1729";
  const accent = t?.accent || "#4f46e5";

  const W = 1000, spineX = W / 2, M = 28, LH = 19, FS = 13.5;
  const headerH = 104, footerH = 42;
  const PANEL = { L: { x: 28, w: 444 }, R: { x: 528, w: 444 } };

  const metrics: Array<[string, string]> = [
    ["Year 1 revenue", fmtMoney(s.year1Revenue, cur)],
    ["Monthly break-even", s.breakEvenMonth ? `Month ${s.breakEvenMonth}` : "Beyond horizon"],
    ["Max cash drawdown", fmtMoney(s.maxDrawdown, cur)],
    [`MRR at month ${s.horizon}`, fmtMoney(s.endingMRR, cur)],
  ];

  const milestones = (assumptions as { milestones?: Array<{ month?: number; label?: string }> }).milestones || [];
  const partyLines = (assumptions.parties || []).slice(0, 7).map((p) =>
    wrapText(`${p.name} (${p.role}): ${fmtMoney(Number(p.revenuePerUnitPerMonth) || 0, cur)}/unit/mo, CAC ${fmtMoney(Number(p.cacPerUnit) || 0, cur)}`, PANEL.L.w - 60, FS));
  const msLines = [...milestones].sort((a, b) => (a.month || 0) - (b.month || 0)).slice(0, 9)
    .map((m) => ({ month: m.month ?? 0, lines: wrapText(m.label || "", PANEL.R.w - 92, FS) }));
  const narrLines = assumptions.narrative ? wrapText(assumptions.narrative, W - 96, 12.5) : [];

  const cardsY = headerH + 26, cardH = 84, cardGap = 18;
  const cardW = (W - M * 2 - cardGap * 3) / 4;

  const panelTop = cardsY + cardH + 34;
  const listTop = panelTop + 60;
  let ly = listTop; partyLines.forEach((lines) => { ly += lines.length * LH + 10; });
  let ry = listTop; msLines.forEach((m) => { ry += m.lines.length * LH + 10; });
  const colBottom = Math.max(ly, ry, listTop + 26);
  const panelBottom = colBottom + 6;
  const narrTop = panelBottom + 30;
  const narrPanelH = narrLines.length * 17 + 36;
  const footerTop = narrLines.length ? narrTop + narrPanelH + 14 : panelBottom + 24;
  const H = footerTop + footerH;

  const tab = (label: string, x: number, y: number): string => {
    const w = Math.round(label.length * 8.6) + 28, h = 32;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${accent}"/>` +
      `<text class="${disp}" x="${x + w / 2}" y="${y + 21}" text-anchor="middle" font-size="13" font-weight="700" letter-spacing="1.5" fill="#ffffff">${esc(label)}</text>`;
  };

  let body = `<rect width="${W}" height="${H}" fill="${surface}"/>`;
  metrics.forEach((m, i) => {
    const x = M + i * (cardW + cardGap);
    body += `<rect x="${x}" y="${cardsY}" width="${cardW}" height="${cardH}" rx="14" fill="${accent}" opacity="0.08"/>`;
    body += `<rect x="${x}" y="${cardsY}" width="${cardW}" height="${cardH}" rx="14" fill="none" stroke="${accent}" stroke-opacity="0.2"/>`;
    body += `<text class="s" x="${x + 18}" y="${cardsY + 30}" font-size="11.5" fill="#6b7280">${esc(m[0])}</text>`;
    body += `<text class="${disp}" x="${x + 18}" y="${cardsY + 62}" font-size="22" font-weight="700" fill="${accent}">${esc(m[1])}</text>`;
  });

  body += `<rect x="${PANEL.L.x}" y="${panelTop}" width="${PANEL.L.w}" height="${panelBottom - panelTop}" rx="18" fill="${accent}" opacity="0.05"/>`;
  body += `<rect x="${PANEL.R.x}" y="${panelTop}" width="${PANEL.R.w}" height="${panelBottom - panelTop}" rx="18" fill="${accent}" opacity="0.05"/>`;
  body += `<line x1="${spineX}" y1="${panelTop}" x2="${spineX}" y2="${panelBottom}" stroke="#cfd5de" stroke-width="2"/>`;
  body += tab("PARTIES", PANEL.L.x + 22, panelTop + 16);
  body += tab("MILESTONES", PANEL.R.x + 22, panelTop + 16);

  let y = listTop;
  if (!partyLines.length) body += `<text class="s" x="${PANEL.L.x + 24}" y="${y}" font-size="13" fill="#9ca3af">(no parties)</text>`;
  partyLines.forEach((lines) => {
    body += `<circle cx="${PANEL.L.x + 26}" cy="${y - 4}" r="3" fill="${accent}"/>`;
    body += `<text class="s" x="${PANEL.L.x + 40}" y="${y}" font-size="13.5" fill="#374151">` +
      lines.map((ln, i) => `<tspan x="${PANEL.L.x + 40}"${i ? ` dy="${LH}"` : ""}>${esc(ln)}</tspan>`).join("") + `</text>`;
    y += lines.length * LH + 10;
  });
  let my = listTop;
  if (!msLines.length) body += `<text class="s" x="${PANEL.R.x + 24}" y="${my}" font-size="13" fill="#9ca3af">(no milestones)</text>`;
  msLines.forEach((m) => {
    body += `<text class="m" x="${PANEL.R.x + 24}" y="${my}" font-size="11" font-weight="500" fill="${accent}">M${esc(m.month)}</text>`;
    body += `<text class="s" x="${PANEL.R.x + 60}" y="${my}" font-size="13.5" fill="#374151">` +
      m.lines.map((ln, i) => `<tspan x="${PANEL.R.x + 60}"${i ? ` dy="${LH}"` : ""}>${esc(ln)}</tspan>`).join("") + `</text>`;
    my += m.lines.length * LH + 10;
  });

  if (narrLines.length) {
    body += `<rect x="${M}" y="${narrTop}" width="${W - M * 2}" height="${narrPanelH}" rx="14" fill="${accent}" opacity="0.05"/>`;
    body += `<text class="m" x="${M + 18}" y="${narrTop + 22}" font-size="10.5" letter-spacing="1.5" fill="#9ca3af">NOTES</text>`;
    body += `<text class="s" x="${M + 18}" y="${narrTop + 42}" font-size="12.5" fill="#6b7280">` +
      narrLines.map((ln, i) => `<tspan x="${M + 18}"${i ? ` dy="17"` : ""}>${esc(ln)}</tspan>`).join("") + `</text>`;
  }

  body += `<rect x="0" y="0" width="${W}" height="${headerH}" fill="${ink}"/>`;
  body += `<text class="m" x="40" y="38" font-size="11" letter-spacing="3" fill="#ffffff" fill-opacity="0.5">THE THOUGHT LAYER</text>`;
  body += `<text class="m" x="${W - 40}" y="38" font-size="11" letter-spacing="3" fill="#ffffff" fill-opacity="0.5" text-anchor="end">FINANCIALS</text>`;
  body += `<text class="${disp}" x="${spineX}" y="74" font-size="44" font-weight="700" letter-spacing="4" fill="#ffffff" text-anchor="middle">BUSINESS MODEL</text>`;
  body += `<rect x="0" y="${footerTop}" width="${W}" height="${footerH}" fill="${ink}"/>`;
  body += `<text class="m" x="${spineX}" y="${footerTop + 26}" font-size="11" fill="#ffffff" fill-opacity="0.55" text-anchor="middle">The Thought Layer, figures are your assumptions, computed locally</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${fontStyle}${body}</svg>`;
}

// ---- brand look book (HTML, ported faithfully) -------------------------------

export function brandLookbookHtml(guide: BrandGuide | null | undefined, logoSvg?: string): string {
  if (!guide) return "";
  const role = (re: string, fb: string): string => (guide.palette || []).find((p) => p?.name && new RegExp(re, "i").test(p.name))?.hex || fb;
  const primary = role("primary", guide.palette?.[0]?.hex || "#1a1a2e");
  const accent = role("accent|secondary", guide.palette?.[1]?.hex || "#e94f37");
  const ink = role("ink|text|dark|black", "#14141b");
  const surface = role("surface|background|light|paper|off.?white|cream", "#fbfaf7");
  const muted = role("muted|gray|grey|neutral|border", "#8a8a99");
  const disp = guide.typography?.display?.family || "Georgia";
  const body = guide.typography?.body?.family || "system-ui";
  const fontsUrl = `https://fonts.googleapis.com/css2?family=${fam(disp)}:wght@400;600;700&family=${fam(body)}:wght@400;500;600&display=swap`;
  const name = esc(guide.brandName || "Your Brand");
  const tagline = esc(guide.tagline || "");
  const messaging = guide.messaging || [];
  const hero = esc(messaging[0] || guide.positioning || guide.brandName || "");
  const lockup = logoSvg || `<span class="wordmark">${name}</span>`;
  const initials = (guide.brandName || "B").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
  const swatches = (guide.palette || []).map((p) =>
    `<div class="sw"><div class="chip" style="background:${esc(p.hex)}"></div><div class="swmeta"><strong>${esc(p.name)}</strong><code>${esc(p.hex)}</code><span>${esc(p.role)}</span></div></div>`).join("");
  const traits = (guide.personality || []).map((tr) => `<span class="pill">${esc(tr)}</span>`).join("");
  const dos = (guide.voice?.dos || []).map((d) => `<li>${esc(d)}</li>`).join("");
  const donts = (guide.voice?.donts || []).map((d) => `<li>${esc(d)}</li>`).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} Brand Look Book</title><link href="${fontsUrl}" rel="stylesheet"><style>
:root{--p:${primary};--a:${accent};--ink:${ink};--su:${surface};--mu:${muted};--disp:'${disp}',Georgia,serif;--body:'${body}',system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}body{background:var(--su);color:var(--ink);font-family:var(--body);line-height:1.6}
.wrap{max-width:960px;margin:0 auto;padding:0 28px}
section{padding:60px 0;border-bottom:1px solid color-mix(in srgb,var(--mu) 30%,transparent)}
.eyebrow{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--mu);font-weight:600;margin-bottom:16px}
h2{font-family:var(--disp);font-size:30px;font-weight:700}
.wordmark{font-family:var(--disp);font-size:44px;font-weight:700;color:var(--su)}
.cover{background:var(--p);color:var(--su);padding:84px 0}
.cover .lockup{display:inline-block;margin-bottom:26px}.cover .lockup svg{height:64px;width:auto}
.cover h1{font-family:var(--disp);font-size:clamp(32px,6vw,58px);font-weight:700;line-height:1.08;margin:12px 0}
.cover p{font-size:18px;opacity:.85;max-width:640px}
.pill{display:inline-block;background:color-mix(in srgb,var(--a) 16%,transparent);color:#fff;border:1px solid color-mix(in srgb,#fff 30%,transparent);border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;margin:0 8px 8px 0}
.swatches{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
.sw{border:1px solid color-mix(in srgb,var(--mu) 28%,transparent);border-radius:12px;overflow:hidden;background:#fff}
.chip{height:80px}.swmeta{padding:12px 14px;font-size:13px;display:flex;flex-direction:column;gap:2px}
.swmeta code,.swmeta span{color:var(--mu);font-size:12px}
.big{font-family:var(--disp);font-size:62px;font-weight:700;line-height:1.05}
.row{font-family:var(--disp);font-size:24px;margin-top:6px;color:var(--a)}
.bodyspec{font-size:16px;max-width:640px;margin-top:16px}
.voice{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:8px}
.col{border:1px solid color-mix(in srgb,var(--mu) 28%,transparent);border-radius:12px;padding:18px 20px;background:#fff}
.col h3{font-size:13px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
.col ul{list-style:none}.col li{padding:5px 0 5px 22px;position:relative;font-size:14px}
.col li:before{position:absolute;left:0}.do li:before{content:"+";color:var(--a);font-weight:700}.dont li:before{content:"x";color:var(--mu)}
.apps{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.mock{border:1px solid color-mix(in srgb,var(--mu) 28%,transparent);border-radius:14px;overflow:hidden;background:#fff}
.cap{font-size:12px;color:var(--mu);padding:8px 14px;border-top:1px solid color-mix(in srgb,var(--mu) 22%,transparent)}
.appbar{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;background:var(--su);border-bottom:1px solid color-mix(in srgb,var(--mu) 22%,transparent)}
.appbar .lk svg{height:24px}.appbar .lk .wordmark{font-size:18px;color:var(--ink)}
.appbar nav{font-size:12px;color:var(--mu);display:flex;gap:14px}
.appbody{height:118px;background:repeating-linear-gradient(0deg,transparent,transparent 22px,color-mix(in srgb,var(--mu) 9%,transparent) 23px)}
.card{aspect-ratio:1.75;background:var(--p);color:var(--su);padding:22px;display:flex;flex-direction:column;justify-content:space-between}
.card .lk svg{height:26px}.card .nm{font-family:var(--disp);font-size:22px;font-weight:700}.card .tg{font-size:12px;opacity:.8}
.slide{padding:26px;background:var(--su)}.slide .kicker{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--a);font-weight:600}
.slide h4{font-family:var(--disp);font-size:25px;font-weight:700;margin-top:6px;line-height:1.15}.slide .bar{width:46px;height:4px;background:var(--a);margin-top:14px;border-radius:2px}
.avatar{height:158px;display:flex;align-items:center;justify-content:center}.circle{width:84px;height:84px;border-radius:50%;background:var(--a);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;font-size:30px}
.foot{padding:36px 0;color:var(--mu);font-size:12px}
@media(max-width:680px){.voice,.apps{grid-template-columns:1fr}}
</style></head><body>
<section class="cover"><div class="wrap">
<div class="lockup">${lockup}</div>
<div class="eyebrow" style="color:rgba(255,255,255,.7)">Brand Look Book</div>
<h1>${hero}</h1>${tagline ? `<p>${tagline}</p>` : ""}
<div style="margin-top:20px">${traits}</div>
</div></section>
<section><div class="wrap"><div class="eyebrow">Positioning</div><h2>${name}</h2>
<p style="font-size:18px;max-width:680px;margin-top:8px">${esc(guide.positioning || "")}</p></div></section>
<section><div class="wrap"><div class="eyebrow">Color</div><h2>Palette</h2><div class="swatches" style="margin-top:20px">${swatches}</div></div></section>
<section><div class="wrap"><div class="eyebrow">Type</div><h2>Typography</h2>
<div class="big" style="margin-top:18px">${name}</div><div class="row">${esc(disp)} for display</div>
<p class="bodyspec">Set in ${esc(body)} for body and UI. ${esc(messaging[1] || "The quick brown fox jumps over the lazy dog 0123456789.")}</p></div></section>
<section><div class="wrap"><div class="eyebrow">Voice</div><h2>How the brand sounds</h2>
<p style="max-width:680px;margin-top:8px">${esc(guide.voice?.tone || "")}</p>
<div class="voice"><div class="col do"><h3>Do</h3><ul>${dos || "<li>(none)</li>"}</ul></div><div class="col dont"><h3>Don't</h3><ul>${donts || "<li>(none)</li>"}</ul></div></div></div></section>
<section><div class="wrap"><div class="eyebrow">In the wild</div><h2>The identity applied</h2>
<div class="apps" style="margin-top:20px">
<div class="mock"><div class="appbar"><span class="lk">${lockup}</span><nav><span>Home</span><span>Pricing</span><span>Sign in</span></nav></div><div class="appbody"></div><div class="cap">App and website header</div></div>
<div class="mock"><div class="card"><span class="lk" style="filter:brightness(0) invert(1)">${lockup}</span><div><div class="nm">${name}</div><div class="tg">${tagline}</div></div></div><div class="cap">Business card</div></div>
<div class="mock"><div class="slide"><div class="kicker">${esc((guide.personality || [])[0] || "Brand")}</div><h4>${hero}</h4><div class="bar"></div></div><div class="cap">Slide title</div></div>
<div class="mock"><div class="avatar"><div class="circle">${esc(initials)}</div></div><div class="cap">Social avatar</div></div>
</div></div></section>
<div class="wrap foot">${name} brand look book, generated locally by The Thought Layer. Type: ${esc(disp)} / ${esc(body)}.</div>
</body></html>`;
}

// ---- the orchestrator --------------------------------------------------------

export type ArtifactKind = "markdown" | "svg" | "html" | "json" | "text";

export interface ArtifactFile {
  path: string;
  bytes: number;
  kind: ArtifactKind;
  source: string; // which state slice produced it
}

export interface ArtifactManifest {
  app: "thought-layer";
  kind: "artifacts";
  version: 1;
  generatedAt: string;
  brandName: string;
  files: ArtifactFile[];
}

export interface ArtifactBuildOptions {
  generatedAt: string;
  domain?: string;
  founderName?: string;
}

const kindOf = (path: string): ArtifactKind =>
  path.endsWith(".md") ? "markdown" : path.endsWith(".svg") ? "svg" : path.endsWith(".html") ? "html" : path.endsWith(".json") ? "json" : "text";

// Build the full artifact set from a ProgressState. Every file is gated on the
// relevant state slice being present, EXCEPT the landing page and the README,
// which the kit can always synthesize from the spec.
export function buildArtifactSet(state: ProgressState, opts: ArtifactBuildOptions): { files: Record<string, string>; manifest: ArtifactManifest } {
  const files: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const add = (path: string, content: string, source: string): void => {
    if (content && content.trim()) { files[path] = content; sources[path] = source; }
  };

  const brand = (state.brand && typeof state.brand === "object" ? state.brand : null) as Brand | null;
  const grill = (state.grill && typeof state.grill === "object" ? state.grill : null) as Grill | null;
  const swot = (state.swot && typeof state.swot === "object" ? state.swot : null) as Swot | null;
  const prd = obj(state.prd);
  const bizModel = obj(state.bizModel);
  const research = obj(state.research);
  const assumptions = (bizModel["assumptions"] || null) as Assumptions | null;
  const prdMarkdown = str(prd["markdown"]);

  // PRD + requirements + glossary (the build spec).
  add("PRD.md", prdMarkdown, "prd");
  if (grill?.requirements?.length) add("Requirements.md", requirementsMarkdown(grill), "grill");
  if (grill?.glossary?.length) add("DomainGlossary.md", glossaryMarkdown(grill), "grill");

  // The paste-ready agent build prompt (always available; summarizes the rest).
  add("BuildPrompt.md", buildKitPrompt(grill, prdMarkdown, assumptions, brand, state.feedback as Record<string, unknown>), "prd+grill+bizModel+brand");

  // SWOT (markdown + infographic).
  const swotHasItems = !!swot && Object.values(swot).some((v) => Array.isArray(v) && v.some((x) => x && String(x).trim()));
  if (swotHasItems) {
    add("SWOT.md", swotMarkdown(swot), "swot");
    add("SWOT.svg", swotInfographicSvg(swot, brand), "swot");
  }

  // Business model infographic (the numbers as a one-pager).
  const bizSvg = bizModelInfographicSvg(assumptions, brand);
  if (bizSvg) add("BusinessModel.svg", bizSvg, "bizModel");

  // Market research brief.
  if (research["brief"]) {
    add("MarketResearch.md", `# Market Research\n\n_${str(research["description"])}_\n\n${str(research["brief"])}`, "research");
  }

  // Compliance report (governance, regulatory, licensing, taxation), from the
  // thought-layer-compliance skill. The body is the agent's researched report,
  // which already carries its own "not legal or tax advice" disclaimer.
  const governance = obj(state.governance);
  if (str(governance["report"]).trim()) {
    add("Compliance.md", str(governance["report"]), "governance");
  }

  // Brand kit.
  if (brand?.guide) {
    add("Brand/BrandStyleGuide.md", brandGuideMarkdown(brand.guide), "brand");
    const chosen = (brand.logos || []).find((l) => l.id === brand.chosenLogoId) || (brand.logos || [])[0];
    if (chosen?.svg) add("Brand/Logo.svg", chosen.svg, "brand");
    add("Brand/LookBook.html", brandLookbookHtml(brand.guide, chosen?.svg), "brand");
  }

  // Landing page (the kit can always synthesize this from the spec + brand).
  try {
    const spec = extractScaffoldSpec(state);
    const site = buildStarterSite(spec, { domain: opts.domain, founderName: opts.founderName });
    for (const [name, content] of Object.entries(site.files)) add(`LandingPage/${name}`, content, "scaffold");
  } catch { /* spec extraction is best-effort; skip the landing page on failure */ }

  const brandName = str(obj(brand?.guide)["brandName"]) || "Your Product";
  add("README.md", readmeIndex(files, brandName), "index");

  const manifest: ArtifactManifest = {
    app: "thought-layer",
    kind: "artifacts",
    version: 1,
    generatedAt: opts.generatedAt,
    brandName,
    files: Object.keys(files).sort().map((path) => ({
      path,
      bytes: Buffer.byteLength(files[path]!, "utf8"),
      kind: kindOf(path),
      source: sources[path] || "index",
    })),
  };
  return { files, manifest };
}

// A dash-free index of the delivered bundle.
function readmeIndex(files: Record<string, string>, brandName: string): string {
  const has = (p: string) => p in files;
  const lines: string[] = [];
  const row = (p: string, desc: string) => { if (has(p)) lines.push(`- **${p}**: ${desc}`); };
  row("PRD.md", "Complete product requirements document");
  row("Requirements.md", "Numbered, testable requirements by category");
  row("DomainGlossary.md", "Ubiquitous language for the domain");
  row("BuildPrompt.md", "Paste into an AI coding agent (Claude Code, Cursor) to build version 1");
  row("BusinessModel.svg", "The numbers as a one-page infographic");
  row("SWOT.md", "Strengths, weaknesses, opportunities, threats");
  row("SWOT.svg", "The SWOT as a poster infographic");
  row("MarketResearch.md", "The market research brief");
  row("Compliance.md", "Governance, licensing, and tax requirements to review with your legal and tax advisors");
  row("Brand/BrandStyleGuide.md", "Brand voice, palette, and typography");
  row("Brand/Logo.svg", "The chosen logo (vector, editable)");
  row("Brand/LookBook.html", "The identity applied; open in any browser");
  row("LandingPage/index.html", "A deployable landing page; drag onto app.netlify.com/drop");
  return `# ${brandName}: Thought Layer artifacts\n\nEverything The Thought Layer built for this idea, delivered to your own repo.\n\n${lines.join("\n")}\n`;
}
