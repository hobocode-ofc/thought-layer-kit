# Maintainer ledger (your turn)

Things only you can do. Claude keeps adding to this as it builds; you check them off.

## Next session (planned, not started)
- [ ] **Backend-capable build + deploy** for products that genuinely need a server or database. Today build is static-first (the three-question backend test gates and flags any backend, and the deploy publishes a static `dist/`). Next: a path for when a requirement truly needs a backend, e.g. Netlify Functions / a serverless adapter, or a documented separate host, still BYOK and owned. Gate it behind the existing backend test so static stays the default.
- [ ] **More Pi screenshots** for the docs (tl_project output, a `tl deploy` result) so weareallproductmanagersnow.com/pi can show the build and deploy steps. The web docs omit those shots cleanly until they exist; rebuild the page once captured.

## Repo + identity
- [ ] Confirm the package name (`@hobocode/thought-layer`) and repo name (`thought-layer-kit`). Change before anything publishes if you want different.
- [ ] Confirm Hobocode LLC as the license / copyright holder (currently in LICENSE).
- [x] git init + first commit + push. DONE, published public at https://github.com/hobocode-ofc/thought-layer-kit

## npm + distribution
- [x] Package prepped for publish (2026-06-17): `publishConfig.access=public` added; `files` narrowed so `core/*.test.ts` don't ship; tsc clean, 33 tests pass, `npm pack --dry-run` = 22 files / 45.4 kB.
- [x] `npm login` done; `npm whoami` = `hobocode`, so the scope is the username (no org needed).
- [x] **PUBLISHED `@hobocode/thought-layer@0.1.0` (2026-06-17, public).** Done via `npm publish` in your own terminal (passkey 2FA needs the browser; a non-interactive shell can't, so Claude can't publish for you without an Automation token). Verified live: registry 200, `npm view` shows 0.1.0.
- [ ] Test it from npm in Pi: `pi install npm:@hobocode/thought-layer`, then RESTART Pi, confirm `/tl` + skills load.
- [ ] List the package in Pi's `/packages` marketplace.
- [ ] Next release: bump the version first (`npm version patch`) — npm refuses to overwrite a published version.

## Testing in real environments
- [x] Skills load in Claude Code (`cp -r skills/* ~/.claude/skills/`): verified, they appear and load.
- [x] `pi install git:...` from the published source: verified, including the production dependency install (`@sinclair/typebox` pulled, the ship-blocker fix confirmed on the real path).
- [x] Extension loads + `tl_score` / `tl_domains` / `tl_project` register and return exact outputs: verified by a deterministic test (`extensions/thought-layer.test.ts`), and the `.d.ts` load error is fixed (shim moved to `types/`).
- [ ] **Your last interactive check** (needs your Pi session + model key): run `pi`, type `/` to confirm `/tl`, `/tl-panel`, `/tl-grill`, `/tl-prd`, `/tl-naming` appear, ask the agent to use the tools (expect 65%/yellow/D and $1,050/$300/month 1), and run `/tl-panel` on a real idea. Confirm Pi appends your text after the command (if it expects `{{var}}` substitution instead, tell me and I will add placeholders).

## Phase 4 (deploy) - BUILT
- [x] **Deploy model decided: BOTH, token-first (2026-06-17).** Primary = BYO Netlify token (`NETLIFY_AUTH_TOKEN`, read from env only) deploying into the user's OWN account via the file-digest API (no zip, no deps) - the site is theirs immediately, no claim. Zero-account fallback = the Netlify CLI's own `netlify deploy --allow-anonymous` (1-hour claim link). We deliberately did NOT build the `netlify/deploy-and-claim` OAuth flow: it requires a *provider* Netlify account + OAuth app + admin PAT (it hosts in the provider's team, then claims out), which is the central infra the kit's "nothing phones home / BYOK / MIT" ethos rules out. No OAuth client_id needed.
- [x] Shipped: `core/deploy.ts` (pure: sha1 digest map, dedupe, upload-path encoding, deploy.json record) + `core/deploy-io.ts` (build.json read, publish-dir walk, Netlify digest deploy, anonymous-CLI delegation, `--allow-anonymous` capability probe), the `deploy` Pi tool, `tl deploy` CLI (`--dry-run`/`--anonymous`/`--name`/`--site`/`--path`), the `thought-layer-deploy` skill + `/tl-deploy` prompt. 76 tests pass, tsc clean, dist builds. Verified the scaffold -> build.json -> `tl deploy --dry-run` round trip through the built CLI.
- [x] **Token deploy path LIVE-VERIFIED 2026-06-18** against the real Netlify API (used the netlify CLI's stored token). Scaffolded a temp project, `tl deploy` created a NEW random site (no `--name`/`--site`, so no collision), 5/7 files uploaded (2 deduped by sha1), state `ready`; live URL + `/llms.txt` both HTTP 200 serving the scaffolded page; the 10 existing sites were untouched; then the throwaway was deleted (account back to 10). The digest deploy + dedupe + deploy.json record are end-to-end proven.
- [x] **CLI (no-token) path FIXED + live-verified 2026-06-18 (0.4.1).** Found a real bug while testing: `--allow-anonymous` is a no-op when the netlify CLI is logged in (its stored config, independent of env), so the old "no token -> anonymous" branch failed for any logged-in user (the common case) with "No project linked." Fix: the CLI path now checks login (`netlify api getCurrentUser`) and, when logged in, creates a site in the user's own account (`--create-site`, owned, no claim); only logged-out uses `--allow-anonymous`. Also added `--no-build` and a URL parser that strips a wrapping `<...>` bracket. Live-verified the logged-in create-site path end to end (deployed, served HTTP 200, then deleted the test sites; account untouched).
- [ ] **The logged-OUT anonymous path is still not live-verified** - it can't be tested here without `netlify logout` (which would drop your stored login). It is wired to Netlify's own `--allow-anonymous`; to confirm it yourself: `netlify logout`, then `tl deploy` with no token, expect an anonymous URL + a one-hour claim link (then `netlify login` again).
- [ ] **Publish `@hobocode/thought-layer@0.4.1`** (the CLI-login fix; version already bumped in the tree). `npm publish` from your terminal.

## Phase 4 prep - npm release
- [ ] **Bump + publish `@hobocode/thought-layer@0.4.0`** (deploy step; 0.3.0 = build/scaffold was committed but never published, so 0.4.0 will be the first published release to contain both build and deploy). `npm version` already set to 0.4.0 in the tree. Publish from your own terminal (passkey 2FA): `npm publish`. `prepublishOnly` runs typecheck + test + build.

## Strategic / cross-repo decisions
- [ ] Decide whether the web app should import this `core/` (drift prevention) once it stabilizes, vs leaving the two copies independent.
