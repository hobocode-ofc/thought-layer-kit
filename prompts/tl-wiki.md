Apply the **thought-layer-wiki** skill. Build me a private Notion wiki, an internal intranet that organizes everything this workflow produced.

First make sure I have delivered the artifacts (`tl artifacts --name <session>`), so the wiki can link to the files in my repo; if I have not, build from the session state and tell me the Artifacts database will be empty until I deliver them. The wiki reads my session from my private sessions repo, so honor `--name` / `--workspace` / `--dir`.

Read my Notion token only from the environment (`THOUGHT_LAYER_NOTION_TOKEN` or `NOTION_TOKEN`), never ask me to paste it. I create an internal integration at notion.so/my-integrations, set the token, and share a Notion page with the integration; pass that page as `--parent-page <id or url>`. If the token or the parent page is missing, tell me exactly what to do rather than pretending it worked.

Dry-run first (`tl wiki --name <session> --dry-run`) so I can see the area pages, block counts, and artifact count. Then build it: a root "<Product> workspace" page, a child page per workflow area that has content (Big Idea, Business Model, Brand, Market Research, Strategy, PRD, Decision Science), rendered natively in Notion, plus an Artifacts database that links each delivered file to its GitHub copy. Upload small files only where no link exists; Notion's free tier caps uploads at 5 MiB, so larger files link out.

It is idempotent: re-running refreshes the existing pages (the page ids are stored locally, never synced); `--replace` rebuilds from scratch. After it is built, give me the root page URL.
