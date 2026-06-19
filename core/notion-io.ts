// Node IO for the Notion wiki, shared by the `tl wiki` CLI and the tl_wiki Pi
// tool. The pure plan (state -> pages + blocks) lives in notion.ts; this calls
// the Notion REST API directly with the global fetch (Node 18+), so the kit
// stays dependency-free and the bundle never grows. It find-or-creates the wiki
// pages idempotently (Notion has no upsert), refreshes their content, and builds
// an Artifacts database.
//
// Secrets: the Notion token is read ONLY from the environment (BYOK), never a
// CLI flag or tool parameter, never persisted. The parent page id is not a
// secret, so it may be a flag. The page-id map is machine-local and not synced.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { git, isGitRepo, loadConfig, resolveWorkspace } from "./sync-io.ts";
import { slugify } from "./sync.ts";
import { repoOwnerName } from "./artifacts-io.ts";
import { STATE_DIR, loadStateFile } from "./state-file.ts";
import { buildWikiPlan, chunkChildren, type Block, type WikiPlan, type WikiArtifact } from "./notion.ts";
import type { ArtifactManifest } from "./artifacts.ts";
import type { StateOpResult } from "./state-ops.ts";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MIN_INTERVAL_MS = 350; // ~3 requests/second
const TOKEN_ENVS = ["THOUGHT_LAYER_NOTION_TOKEN", "NOTION_TOKEN"];

export interface WikiRunOptions {
  path?: string; // explicit source state file
  name?: string; // session name (the wiki + id-map key)
  workspace?: string; // sessions workspace label
  dir?: string; // explicit clone dir
  parentPage?: string; // Notion page id or URL the integration is shared with
  replace?: boolean; // recreate the root page from scratch (new ids)
  dryRun?: boolean; // build the plan, report counts, no network
}

const ok = (message: string, details: Record<string, unknown> = {}): StateOpResult => ({ ok: true, message, details });
const fail = (message: string, details: Record<string, unknown> = {}): StateOpResult => ({ ok: false, message, details });

// ---- machine-local page-id map (mirrors sync.json) ---------------------------

interface NotionEntry { rootPageId?: string; areaPageIds?: Record<string, string>; artifactsDbId?: string; updatedAt?: number; }
interface NotionConfig { schema: number; sessions: Record<string, NotionEntry>; }

function notionConfigPath(): string {
  return process.env["THOUGHT_LAYER_NOTION_CONFIG"] || join(homedir(), ".thought-layer", "notion.json");
}
function loadNotionConfig(): NotionConfig {
  const p = notionConfigPath();
  if (!existsSync(p)) return { schema: 1, sessions: {} };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const sessions = raw["sessions"] && typeof raw["sessions"] === "object" ? raw["sessions"] as Record<string, NotionEntry> : {};
    return { schema: 1, sessions };
  } catch { return { schema: 1, sessions: {} }; }
}
function saveNotionConfig(cfg: NotionConfig): void {
  const p = notionConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

// ---- helpers -----------------------------------------------------------------

// Accept a raw 32-hex id, a dashed UUID, or a Notion URL; return a dashed UUID.
export function pageIdFromInput(s: string): string | null {
  const t = String(s || "").trim();
  const dashed = t.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (dashed) return dashed[0].toLowerCase();
  const runs = t.match(/[0-9a-fA-F]{32}/g);
  if (!runs || !runs.length) return null;
  const id = runs[runs.length - 1]!.toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A small serial Notion client: paces requests to ~3/s and backs off on 429.
class Notion {
  private last = 0;
  constructor(private token: string) {}

  async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    for (let attempt = 0; ; attempt++) {
      const wait = MIN_INTERVAL_MS - (Date.now() - this.last);
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const res = await fetch(`${NOTION_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && attempt < 4) {
        const retry = Number(res.headers.get("Retry-After")) || Math.pow(2, attempt);
        await sleep(retry * 1000);
        continue;
      }
      let json: Record<string, unknown> = {};
      try { json = (await res.json()) as Record<string, unknown>; } catch { /* empty body */ }
      return { status: res.status, json };
    }
  }

  async pageExists(id: string): Promise<boolean> {
    const r = await this.call("GET", `/pages/${id}`);
    return r.status === 200 && r.json["archived"] !== true;
  }

  async createPage(parentPageId: string, title: string, emoji?: string): Promise<string> {
    const r = await this.call("POST", "/pages", {
      parent: { page_id: parentPageId },
      ...(emoji ? { icon: { type: "emoji", emoji } } : {}),
      properties: { title: { title: [{ text: { content: title } }] } },
    });
    if (r.status !== 200) throw new Error(notionErr("create page", r));
    return String(r.json["id"]);
  }

  // Replace a page's content: delete every existing child, then append the new
  // blocks in <=100-block batches.
  async replaceChildren(pageId: string, blocks: Block[]): Promise<void> {
    let cursor: string | undefined;
    do {
      const q = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
      const r = await this.call("GET", `/blocks/${pageId}/children${q}`);
      if (r.status !== 200) break;
      for (const b of (r.json["results"] as Array<{ id: string }>) || []) await this.call("DELETE", `/blocks/${b.id}`);
      cursor = r.json["has_more"] ? String(r.json["next_cursor"]) : undefined;
    } while (cursor);
    for (const batch of chunkChildren(blocks)) {
      if (!batch.length) continue;
      const r = await this.call("PATCH", `/blocks/${pageId}/children`, { children: batch });
      if (r.status !== 200) throw new Error(notionErr("append blocks", r));
    }
  }

  async createArtifactsDb(parentPageId: string, artifacts: WikiArtifact[]): Promise<string> {
    const cats = Array.from(new Set(artifacts.map((a) => a.category)));
    const r = await this.call("POST", "/databases", {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ text: { content: "Artifacts" } }],
      icon: { type: "emoji", emoji: "📎" },
      properties: {
        Name: { title: {} },
        Category: { select: { options: cats.map((c) => ({ name: c })) } },
        Size: { rich_text: {} },
        Link: { url: {} },
      },
    });
    if (r.status !== 200) throw new Error(notionErr("create database", r));
    return String(r.json["id"]);
  }

  async addArtifactRow(dbId: string, a: WikiArtifact): Promise<void> {
    await this.call("POST", "/pages", {
      parent: { database_id: dbId },
      properties: {
        Name: { title: [{ text: { content: a.name } }] },
        Category: { select: { name: a.category } },
        Size: { rich_text: [{ text: { content: humanSize(a.bytes) } }] },
        ...(a.url ? { Link: { url: a.url } } : {}),
      },
    });
  }
}

function notionErr(what: string, r: { status: number; json: Record<string, unknown> }): string {
  const msg = String(r.json["message"] || "").slice(0, 200);
  return `Notion ${what} failed (${r.status})${msg ? `: ${msg}` : ""}`;
}
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- the orchestrator --------------------------------------------------------

export async function runWiki(opts: WikiRunOptions): Promise<StateOpResult> {
  try {
    const cfg = loadConfig();
    const { cloneDir, ws } = resolveWorkspace(opts as never, cfg);
    if (!isGitRepo(cloneDir)) {
      return fail(`No sessions workspace at ${cloneDir}. Run tl sync init then tl artifacts before building the wiki.`, { cloneDir });
    }
    const slug = slugify(opts.name || ws?.activeSession?.replace(/\.json$/, "") || "");
    if (!slug) return fail("Name the session to publish: tl wiki --name <name>.");

    // Load the session state.
    const sessionPath = join(cloneDir, STATE_DIR, `${slug}.json`);
    const useExplicit = !!((opts.path && opts.path.trim()) || (process.env["THOUGHT_LAYER_STATE"] || "").trim());
    const loaded = loadStateFile(useExplicit ? opts.path : existsSync(sessionPath) ? sessionPath : opts.path);
    if (!loaded.exists) return fail(`No session "${slug}" found (looked at ${loaded.path}). Save it first with tl sync save --name ${slug}.`, { cloneDir });

    // Read the delivered artifacts manifest + recompute GitHub URLs (if delivered).
    const artifactsDir = join(cloneDir, "artifacts", slug);
    let manifest: ArtifactManifest | null = null;
    const manifestPath = join(artifactsDir, "artifacts.json");
    if (existsSync(manifestPath)) {
      try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ArtifactManifest; } catch { manifest = null; }
    }
    const branch = git(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim() || ws?.defaultBranch || "main";
    const ownerName = repoOwnerName(ws?.repo || "");
    const urls: Record<string, string> = {};
    if (ownerName && manifest) {
      const base = `https://github.com/${ownerName}/blob/${branch}/artifacts/${slug}`;
      for (const f of manifest.files) urls[f.path] = `${base}/${f.path.split("/").map(encodeURIComponent).join("/")}`;
    }

    const plan: WikiPlan = buildWikiPlan(loaded.state, { manifest, urls });
    const blockCount = plan.overview.length + plan.areas.reduce((n, a) => n + a.blocks.length, 0);

    if (opts.dryRun) {
      const areaList = plan.areas.map((a) => `${a.emoji} ${a.title} (${a.blocks.length} blocks)`).join(", ");
      return ok(
        `Dry run for "${plan.title}": ${plan.areas.length} area page(s), ${blockCount} blocks total, ${plan.artifacts.length} artifact(s) in the database.\nAreas: ${areaList || "(none with content yet)"}.${manifest ? "" : "\nNo delivered artifacts found; run tl artifacts first to populate the Artifacts database with GitHub links."}`,
        { title: plan.title, areas: plan.areas.map((a) => ({ key: a.key, blocks: a.blocks.length })), blockCount, artifacts: plan.artifacts.length, delivered: !!manifest },
      );
    }

    // Token (BYOK, env only) and parent page are required for the live run.
    const token = TOKEN_ENVS.map((e) => process.env[e]).find((v) => v && v.trim())?.trim() || "";
    if (!token) {
      return fail(
        "No Notion token. Create an internal integration at https://www.notion.so/my-integrations, copy its secret, and set THOUGHT_LAYER_NOTION_TOKEN. Then share a Notion page with the integration and pass it as --parent-page.",
        { needs: "token" },
      );
    }

    const ncfg = loadNotionConfig();
    const entry: NotionEntry = ncfg.sessions[slug] || {};
    const notion = new Notion(token);

    // Resolve / verify the root page. With --replace, force a fresh root.
    let rootId = opts.replace ? "" : entry.rootPageId || "";
    if (rootId && !(await notion.pageExists(rootId))) rootId = "";
    if (!rootId) {
      const parentInput = opts.parentPage || process.env["THOUGHT_LAYER_NOTION_PARENT"] || "";
      const parentId = pageIdFromInput(parentInput);
      if (!parentId) {
        return fail(
          "No Notion parent page. Share a page with your integration in Notion (Share, then add your integration), then pass it as --parent-page <id or url>.",
          { needs: "parent-page" },
        );
      }
      if (!(await notion.pageExists(parentId))) {
        return fail(`Notion cannot see the parent page ${parentId}. In Notion, open the page, click Share, and add your integration so it has access.`, { needs: "share" });
      }
      rootId = await notion.createPage(parentId, plan.title, plan.icon);
      entry.areaPageIds = {};
      entry.artifactsDbId = undefined;
    }
    await notion.replaceChildren(rootId, plan.overview);

    // Area child pages: find-or-create, then refresh content.
    const areaIds: Record<string, string> = entry.areaPageIds || {};
    for (const area of plan.areas) {
      let pid = areaIds[area.key] || "";
      if (pid && !(await notion.pageExists(pid))) pid = "";
      if (!pid) pid = await notion.createPage(rootId, `${area.emoji} ${area.title}`, area.emoji);
      areaIds[area.key] = pid;
      await notion.replaceChildren(pid, area.blocks);
    }

    // Artifacts database: create once, then add a row per artifact. (Idempotent
    // re-runs reuse the stored db; rows are appended, so --replace gives a clean
    // db by recreating the whole wiki.)
    let dbId = entry.artifactsDbId || "";
    if (plan.artifacts.length && (!dbId || opts.replace)) {
      dbId = await notion.createArtifactsDb(rootId, plan.artifacts);
      for (const a of plan.artifacts) await notion.addArtifactRow(dbId, a);
    }

    ncfg.sessions[slug] = { rootPageId: rootId, areaPageIds: areaIds, artifactsDbId: dbId || undefined, updatedAt: Date.now() };
    saveNotionConfig(ncfg);

    const rootUrl = `https://www.notion.so/${rootId.replace(/-/g, "")}`;
    return ok(
      `Built the "${plan.title}" wiki in Notion: ${plan.areas.length} area page(s), ${blockCount} blocks, ${plan.artifacts.length} artifact(s) listed.` +
        `${manifest ? "" : " No delivered artifacts were found, so the Artifacts database links are empty; run tl artifacts first."}` +
        `\nOpen it: ${rootUrl}`,
      { title: plan.title, rootPageId: rootId, rootUrl, areas: plan.areas.length, blockCount, artifacts: plan.artifacts.length },
    );
  } catch (e) {
    return fail(`tl_wiki error: ${(e as Error).message}`);
  }
}
