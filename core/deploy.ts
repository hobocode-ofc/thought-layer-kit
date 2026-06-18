// Deterministic, no-IO helpers for the deploy step: hash the publish dir into
// the Netlify file-digest map, derive a safe site name, build the deploy.json
// record, and parse the anonymous-CLI output. The fs walk and the network calls
// live in deploy-io.ts; keeping these pure means the digest + record logic is
// unit-testable without touching disk or the Netlify API.
//
// Netlify's file-digest deploy (the path we use with a BYO token) needs no zip
// and no dependencies: POST a { "/path": sha1 } map, then PUT the raw bytes for
// each sha1 Netlify reports back as `required`. crypto.createHash is the only
// import and it is pure (content in, hex out).

import { createHash } from "node:crypto";

export const sha1Hex = (data: Buffer | string): string =>
  createHash("sha1").update(data).digest("hex");

// A file map is keyed by the site-relative path WITH a leading slash, posix
// separators (e.g. "/index.html", "/assets/app.js") - the shape Netlify's
// deploys endpoint expects in its `files` object.
export type FileMap = Record<string, Buffer>;

export interface FileDigests {
  // path (leading slash) -> sha1, sent as the deploy `files` body.
  digests: Record<string, string>;
  // sha1 -> one path that has it, so an upload happens once per unique sha1
  // even when several files share content.
  pathForDigest: Record<string, string>;
}

export function buildFileDigests(files: FileMap): FileDigests {
  const digests: Record<string, string> = {};
  const pathForDigest: Record<string, string> = {};
  for (const [path, buf] of Object.entries(files)) {
    const key = normalizeKey(path);
    const sha = sha1Hex(buf);
    digests[key] = sha;
    if (!(sha in pathForDigest)) pathForDigest[sha] = key;
  }
  return { digests, pathForDigest };
}

// Normalize a relative path to a leading-slash posix key.
export function normalizeKey(path: string): string {
  const posix = path.replace(/\\/g, "/").replace(/^\.?\/*/, "");
  return "/" + posix;
}

// The URL segment for a PUT files/<path> upload: drop the leading slash and
// percent-encode each segment (Netlify forbids raw # and ? in the path), while
// preserving the slashes that separate directories.
export function uploadPath(key: string): string {
  return key
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

// Netlify site names are a global namespace of [a-z0-9-]. Derive a clean
// candidate from a brand/product name; empty -> "" so the caller lets Netlify
// assign a random subdomain instead (no collision risk).
export function sanitizeSiteName(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

// Pull the live URL and (anonymous only) the claim link out of `netlify deploy`
// output. The CLI prints several *.netlify.app URLs - the production site URL
// and a unique per-deploy URL (whose host carries a "--" prefix); prefer the
// production one. The claim link only appears for an anonymous, unclaimed site;
// we never synthesize it ourselves (the handshake is Netlify's, not ours).
export function parseCliDeployOutput(output: string): { url: string | null; claimUrl: string | null } {
  // Stop the URL at whitespace OR a wrapping bracket/quote: the CLI sometimes
  // prints links as <url> or in a box, and a greedy \S* would swallow the ">".
  const claim = output.match(/https:\/\/app\.netlify\.com\/claim[^\s<>"')\]]*/);
  const all = (output.match(/https:\/\/[a-z0-9-]+\.netlify\.app[^\s<>"')\]]*/gi) || []).map(stripTrailingPunctuation);
  const host = (u: string): string => u.replace(/^https:\/\//, "").split("/")[0]!;
  const prod = all.find((u) => !host(u).includes("--")); // skip the per-deploy URL
  return {
    url: prod || all[0] || null,
    claimUrl: claim ? stripTrailingPunctuation(claim[0]) : null,
  };
}

const stripTrailingPunctuation = (s: string): string => s.replace(/[)\]>.,'"<]+$/, "");

// The deploy record written next to build.json / the state file. Pure provenance
// so a re-deploy can target the same site and the user can find their URLs.
export interface DeployRecord {
  app: "thought-layer";
  kind: "deploy";
  version: 1;
  deployedAt: string;
  mode: "token" | "cli" | "anonymous" | "dry-run";
  provider: "netlify";
  publishDir: string;
  fileCount: number;
  url: string | null;
  adminUrl: string | null;
  claimUrl: string | null;
  siteId: string | null;
  deployId: string | null;
  hasBackend: boolean;
  backendNote: string | null;
  buildProducer: "agent" | "scaffold" | null;
  stateFile: string | null;
}

export function deployRecord(input: Omit<DeployRecord, "app" | "kind" | "version" | "provider">): DeployRecord {
  return { app: "thought-layer", kind: "deploy", version: 1, provider: "netlify", ...input };
}
