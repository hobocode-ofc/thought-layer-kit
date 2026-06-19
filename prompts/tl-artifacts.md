Deliver the full asset bundle for this idea to my own private sessions repo.

Use the `tl_artifacts` tool (or `tl artifacts` via `npx -y @hobocode/thought-layer`). It reads my saved session from the sessions repo, so honor `--name <session>` / `--workspace` / `--dir`; I must have a sessions workspace set up first (`tl sync init`).

Build, from the saved state: the PRD, requirements, domain glossary, the paste-ready build prompt, the brand style guide + look book + logo, the SWOT and business-model infographics, the market research brief, and a deployable landing page. Also copy any on-disk build/deploy provenance (build.json, deploy.json, BACKEND/TRACEABILITY/DECISIONS.md, schema.sql, netlify.toml) into a Deploy/ folder, and write an artifacts.json manifest. Force-add past the sessions .gitignore, commit, and push (newest delivery wins; artifacts are not field-merged).

Tell me how many files were delivered, the path (`artifacts/<session>/`), and the GitHub link. Then I can run `/tl-wiki` to organize them into a private Notion intranet.
