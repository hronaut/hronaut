# MCP directory listing guide

Use [`PUBLIC_FACTS.json`](PUBLIC_FACTS.json) as the reviewed source for Hronaut's
name, description, website, setup and source URLs, supported clients, desktop
platforms, license, trial, prices, and deployment boundary. `LICENSE` remains
authoritative for legal rights and restrictions.
Link users who need maintenance or migration guidance to the canonical
[support, recovery, and exit path](SUPPORT_RECOVERY.md).

## Copy-ready capability summary

Hronaut is a visible desktop browser with persistent, isolated workspaces
controlled by local coding agents through MCP. Download and start Hronaut on
Windows, macOS, or Linux, then copy the local Streamable HTTP setup from Hronaut
Home. The MCP server listens on loopback only. Remote deployment is not
supported, and Hronaut is not a hosted browser or connector. People can watch,
pause, approve, and take over browser work.

Use these canonical links:

- Website: <https://hronaut.dev>
- Setup: <https://hronaut.dev/setup>
- Downloads: <https://github.com/hronaut/hronaut/releases/latest>
- Source: <https://github.com/hronaut/hronaut>
- License: [`LICENSE`](../LICENSE)

Hronaut is source-available under its Subscription and Trial License. Current
terms are a 10-day trial starting with the first agent tool call, followed by
USD $4 per named user per month or USD $24 per named user per year (50% off the
$48 annual reference total). One seat supports up to three active devices.
Recheck `PUBLIC_FACTS.json` before copying these values to another site.

## Glama owner workflow

Glama's server metadata schema was reviewed on 2026-09-14. It accepts only a
`maintainers` array, so [`glama.json`](../glama.json) deliberately contains no
invented deployment, pricing, environment, or build fields. The repository
README and canonical fact set supply the listing copy.

1. Open the [Hronaut server listing](https://glama.ai/mcp/servers/hronaut/hronaut)
   and choose **Claim** while signed in with the GitHub identity that controls
   the `hronaut` repository.
2. Keep the entry classified as a local server. Do not submit the loopback MCP
   URL as a remote connector endpoint and do not add credentials or test tokens.
3. Replace any generic **Deploy Server** instructions with the download, start,
   and local setup flow above. State explicitly that remote deployment is not
   supported.
4. Verify the public listing in a signed-out session. The first usable steps
   must lead to the Hronaut download and local setup pages without promising a
   hosted deployment. Check the displayed license and current commercial terms
   against `PUBLIC_FACTS.json`.
5. Record the review date in `PUBLIC_FACTS.json` whenever controlled directory
   copy, licensing, pricing, platforms, or supported clients change.

Claiming a directory entry establishes edit access only. It does not publish,
proxy, or widen Hronaut's loopback-only MCP endpoint.
