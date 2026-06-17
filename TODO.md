# Maintainer ledger (your turn)

Things only you can do. Claude keeps adding to this as it builds; you check them off.

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

## Phase 4 prep (deploy)
- [ ] Decide the deploy model: BYO Netlify token vs anonymous-deploy-then-claim (or both).
- [ ] If using OAuth claim: create a Netlify OAuth application and capture the client_id.
- [ ] Provision a Netlify personal access token for local testing of the deploy tool.

## Strategic / cross-repo decisions
- [ ] Decide whether the web app should import this `core/` (drift prevention) once it stabilizes, vs leaving the two copies independent.
