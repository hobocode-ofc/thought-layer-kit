# Security

The Thought Layer Kit is bring-your-own-key by design. It has no server, no
telemetry, and no central account. The threat model and the guarantees below
follow from that.

## What the kit handles

- **Secrets are read from the environment only.** The Netlify token
  (`NETLIFY_AUTH_TOKEN` / `NETLIFY_TOKEN`) and the domain-check key
  (`THOUGHT_LAYER_DOMAIN_KEY` / `RAPIDAPI_KEY`) are read from `process.env`. They
  are never accepted as tool or CLI parameters, never logged or printed, and
  never written to disk. The `deploy.json` record stores the resulting URLs and
  ids, never the token. When a build emits a backend, the generated `.env.example`
  is a names-only contract (every line is a bare `NAME=`): real values live only
  in the host environment, never in a committed file. When the deploy sets those
  env vars on your site, it reads the VALUES only from the deploy environment and
  pushes them to your own Netlify account (in the API request body, or a
  `0600`-mode temp file consumed by the Netlify CLI and deleted after); the
  database connection string reaches `psql` through child-process environment
  variables, never a command line. Values are never logged, never placed on a
  command line, and the `deploy.json` record names env vars only, never values.
- **Deploys go to your own account.** With a token, the deploy uses Netlify's
  file-digest API to publish into your account. With no token, it delegates to
  your installed Netlify CLI (a site in your account when logged in, or an
  anonymous, claimable site when logged out). Nothing is hosted on infrastructure
  we control, and there is no claim handshake we mediate.
- **No shell injection.** External commands (the Netlify CLI) are invoked with an
  argument array and no shell, so values such as a site name or publish directory
  cannot break out into a shell. Site names are sanitized to `[a-z0-9-]`.
- **File writes are confined.** The scaffold and state-file writers resolve paths
  against the working directory; the state file and build artifacts live under
  `.thought-layer/` and the chosen publish directory.
- **No network calls you did not ask for.** The only outbound requests are to the
  Netlify API (deploy) and, if you set a domain key, the RapidAPI domains
  endpoint. There is no analytics or phone-home.

## What stays your responsibility

- The kit runs inside your own agent (Pi, Claude Code, or another) on your own
  model and keys. The quality and safety of code an agent builds from a spec is a
  function of that agent and model, not the kit.
- Keep your provider keys and Netlify token in your environment or your agent's
  secret store, not in committed files. `.thought-layer/` and `.env` are
  gitignored in this repo for that reason.

## Reporting a vulnerability

Email security reports to **jerm@hobocode.net**. Please include steps to
reproduce and the affected version. We aim to acknowledge within a few days.
Public disclosure is welcome once a fix is released.

## Supported versions

The latest published `@hobocode/thought-layer` release on npm is the supported
version. Fixes ship forward; please update before reporting.
