---
name: thought-layer-wiki
description: "Auto-generate a PRIVATE Notion wiki: an internal intranet for the founder that organizes everything the workflow built, the validation thinking, brand and styles, business model, PRD, deploy rules, and links to every delivered artifact. Runs from the kit (no web app, no proxy) and calls the Notion API directly. Notion pages are private to the user's own workspace, so the docs sit behind their own auth, not public. BYOK: the integration token is read ONLY from THOUGHT_LAYER_NOTION_TOKEN (or NOTION_TOKEN) in the environment, never a parameter; the parent page shared with the integration is passed as an id or URL. Run tl artifacts first so the Artifacts database links the files in the user's repo. Prefers the tl_wiki tool or the tl wiki CLI; dry-run first. Idempotent: it stores page ids locally and refreshes on re-run, replace rebuilds from scratch. One child page per workflow area; small files upload, larger link to GitHub (free tier caps uploads at 5 MiB)."
---

# Wiki it: a private internal intranet in Notion

The wiki is the founder's keepable home for everything the workflow produced: the thinking that created the business, the brand and styles, the business model, the PRD and requirements, the deploy rules, and a linked index of every delivered artifact. It runs from the kit on the user's own machine and writes into the user's own Notion. Notion pages are private by default, so this satisfies a "behind auth, not public" requirement with no extra infrastructure.

## Preconditions

1. **A sessions workspace.** The wiki reads the session from the user's private sessions repo (set up by the `tl_sync` tool / `tl sync init`). Honor the usual selection: `--name <session>` (or the workspace's active session), `--workspace <label>`, or an explicit `--dir`.
2. **Delivered artifacts (recommended).** Run the `tl_artifacts` tool / **`tl artifacts`** first so `artifacts/<session>/artifacts.json` exists. The wiki reads it to fill the Artifacts database with GitHub links. Without it, the wiki still builds from the session state, but the Artifacts database is empty; the tool says so. Tell the user to deliver artifacts first for the full result.
3. **Notion access (one of two ways).** Either (a) a **Notion MCP / connector** already authorized to the user's workspace, in which case you need no token at all (see "Two ways to build it" below); or (b) a one-time **BYOK integration**: the user creates an internal integration at https://www.notion.so/my-integrations, copies the secret, sets it as `THOUGHT_LAYER_NOTION_TOKEN` (or `NOTION_TOKEN`) in the environment, then in Notion opens the page that should hold the wiki, clicks **Share**, and adds the integration so it has access. That page's id or URL is the `parent-page`. The token is read **only from the environment**; never ask the user to paste it into the chat or put it in a parameter or file.

## Two ways to build it

**First check what you have.** If you (the agent) already have a **Notion MCP / connector** authorized to the user's workspace, prefer it — the user skips the entire integration-token setup. Otherwise use the BYOK token path, which stays the universal floor (the browser SPA and a plain CLI/CI host have no MCP). Both paths render the **same plan**; pick one.

### A. Notion MCP connected (preferred, no token)

Build the wiki through the MCP and never ask for a token:

1. **Get the plan:** `tl wiki --name <session> --emit-plan --json` (or the `tl_wiki` tool with `emitPlan: true`). With **no token and no network call** it returns `{ title, icon, overview, areas: [{ key, title, emoji, markdown }], artifacts: [{ name, category, bytes, url? }] }`. Each area's `markdown` is the ready-to-post page body.
2. **Pick the parent.** Ask the user which Notion page should hold the wiki, unless they already said.
3. **Avoid duplicates first.** The local id-map (`~/.thought-layer/notion.json`) is written only by the token path, so on the MCP path it does not exist. Before creating, **search Notion for an existing page titled `<title>`**; if it exists, update it in place; otherwise create it. If you cannot search, ask the user whether to create fresh or point you at the existing page.
4. **Create the root page** titled `plan.title` under the parent (icon `plan.icon`), with `overview` as its body.
5. **Create one child page per area** in `areas[]`, titled `"<emoji> <title>"`, with that area's `markdown` as the body.
6. **Create the Artifacts database** under the root with columns Name, Category, Size, Link, and one row per `artifacts[]` entry (use its `url` for Link when present).
7. **Report the root page URL.**

### B. No MCP: the BYOK token path (the floor)

Use the tool, never a hand-written Notion `curl`:
- **Pi:** the `tl_wiki` tool. Start with `tl_wiki { name, dryRun: true }` to show the plan (area pages, block counts, artifact count), then `tl_wiki { name, parentPage }` to build it.
- **Any shell agent (Claude Code, CI, a plain terminal):** `tl wiki --name <session> --dry-run`, then `tl wiki --name <session> --parent-page <id|url>` (via `npx -y @hobocode/thought-layer tl wiki`).

Always **dry-run first** and show the user the area + artifact plan, then build.

> GitHub needs no equivalent path: `tl artifacts` and `tl sync` already authenticate via the `gh`/git keyring (no token paste), so a GitHub MCP is not required for delivery.

## What it builds

- A root page **"<Product> workspace"** under the shared parent page.
- One **child page per workflow area** that has content: The Big Idea, Business Model, Brand, Market Research, Strategy, Product (PRD), Decision Science. Empty areas are skipped. Content is rendered **natively** as Notion blocks (the palette and parties become tables, the brand guide and PRD become headings/lists), so it reads well without relying on file previews.
- An **Artifacts database** that lists each delivered file with its category and a **link to its GitHub copy** (decks, look book, logo, infographics, the build prompt, the deploy provenance).

## Files: link vs upload (the 5 MiB rule)

Notion's free tier caps a single uploaded file at 5 MiB. The wiki links artifacts to their GitHub copy when the artifacts were delivered (the normal path), and reserves direct upload for small files where no link exists. Notion cannot inline-render arbitrary SVG or HTML, so the logo, look book, and infographics are linked or attached, not embedded as broken previews; their data is also rendered natively where it makes sense (the palette table, the brand guide text).

## Idempotency and re-runs

Notion has no upsert, so the tool stores the root page id, the per-area page ids, and the Artifacts database id in a **machine-local** `~/.thought-layer/notion.json` (keyed by session). A normal re-run **reuses those pages and refreshes their content**; `--replace` / `replace: true` rebuilds the wiki from scratch (new pages). This id map is local provenance, never synced into the sessions repo.

## Honest failure

If the tool returns `ok: false`, relay its message verbatim, do not claim a wiki was built:
- **No token** -> tell the user to create the integration and set `THOUGHT_LAYER_NOTION_TOKEN`.
- **No parent page** -> tell them to share a Notion page with the integration and pass it as `--parent-page`.
- **Parent not shared** -> the integration cannot see the page; in Notion, Share the page with the integration, then re-run.
