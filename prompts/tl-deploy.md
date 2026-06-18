Apply the **thought-layer-deploy** skill. Take the built site live to a URL I own, with no lock-in.

Read `.thought-layer/build.json` (next to the state file; honor `--path` / `THOUGHT_LAYER_STATE` if a named file is in use) for the publish directory and entry. If there is no `build.json`, say so and point me to `/tl-build` (or the `tl_scaffold` tool) rather than guessing - the build has to run first.

Default to a dry run first so I can see exactly which files would ship and where. Then deploy: if `NETLIFY_AUTH_TOKEN` is set, deploy into my own Netlify account (owned immediately); otherwise delegate to my Netlify CLI - logged in it creates a site in my account, logged out it deploys anonymously with a one-hour claim link. Read the token only from the environment, never ask me to paste it. If `build.json` says `hasBackend: true`, warn me clearly that this static deploy publishes only the front end.

After it is live, tell me the URL and (anonymous only) the claim link, and that a `.thought-layer/deploy.json` record was written.
