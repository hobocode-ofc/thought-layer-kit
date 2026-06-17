# Maintainer ledger (your turn)

Things only you can do. Claude keeps adding to this as it builds; you check them off.

## Repo + identity
- [ ] Confirm the package name (`@hobocode/thought-layer`) and repo name (`thought-layer-kit`). Change before anything publishes if you want different.
- [ ] Confirm Hobocode LLC as the license / copyright holder (currently in LICENSE).
- [ ] `git init` in `thought-layer-kit`, create the GitHub repo (`hobocode-ofc/thought-layer-kit`), first commit, push. (Claude will not commit or push without you asking.)

## npm + distribution
- [ ] Create / claim the `@hobocode` npm scope (npm org), then `npm publish --access public` when ready.
- [ ] List the package in Pi's `/packages` marketplace once published.

## Testing in real environments (Claude cannot fully verify these)
- [ ] Install the skills in a real Claude Code env (`cp -r skills/* ~/.claude/skills/`) and run panel / grill / prd / naming on a real idea. Confirm parity with the web app.
- [ ] Install in a real Pi env (`pi install git:...` or copy to `~/.pi/agent/`), confirm the skills load and the slash commands + tools work in the live Pi runtime. The extension is authored to Pi's documented API but unverified against a running Pi. Specifically confirm:
  - The extension loads and `tl_score` / `tl_domains` / `tl_project` register (depends on `@sinclair/typebox` being a runtime dependency, now fixed, and on jiti resolving the `.ts` relative imports).
  - The prompt commands resolve as `/tl`, `/tl-panel`, `/tl-grill`, `/tl-prd`, `/tl-naming`, and that Pi appends the user's text after the command (the templates end with a trailing label expecting appended input; if Pi uses `{{var}}` substitution instead, add placeholders).
  - The ambient Pi type shim (`extensions/pi-coding-agent.d.ts`) matches the real `@earendil-works/pi-coding-agent` types; replace the shim with the real package if it ships usable types.

## Phase 4 prep (deploy)
- [ ] Decide the deploy model: BYO Netlify token vs anonymous-deploy-then-claim (or both).
- [ ] If using OAuth claim: create a Netlify OAuth application and capture the client_id.
- [ ] Provision a Netlify personal access token for local testing of the deploy tool.

## Strategic / cross-repo decisions
- [ ] Decide whether the web app should import this `core/` (drift prevention) once it stabilizes, vs leaving the two copies independent.
