# Hronaut MCPB adapter

The Hronaut MCPB adapter connects a client's local stdio transport to the
Streamable HTTP endpoint owned by the running Hronaut desktop application. It
does not contain a browser, start Hronaut, copy browser profiles, or accept a
license on the user's behalf.

The bundle archive, manifest, and stdio-to-HTTP tool path are tested on Linux,
macOS, and Windows, then built from the same immutable release tag as the
desktop app. These automated checks use the MCP SDK rather than a graphical
bundle-installation screen. No specific graphical MCPB host/version has
completed this end-to-end path yet; treat host UI compatibility as unverified
until the release notes name a tested host and version. The adapter version
matches the Hronaut release. Each release contains:

- `hronaut-mcp-adapter-<version>.mcpb`, the MCPB 0.3 bundle; and
- `hronaut-mcp-server.json`, the matching MCP Registry metadata with the exact
  release URL and SHA-256 of that bundle.

## Setup

1. Install and start the matching Hronaut desktop release.
2. Open Hronaut Home and copy the current MCP endpoint.
3. Install the `.mcpb` file in a local client that supports MCPB 0.3 and set the
   **Hronaut MCP endpoint** field to the loopback URL from Hronaut Home.
4. If MCP authentication is enabled, Home displays the owner-only token file
   path, not the raw token. Use the bundle host's local file picker to select
   that file in the host's **Hronaut MCP token file** field. The host passes the
   path to the local adapter, which reads the token into memory and sends it
   only to the configured loopback endpoint. Do not paste the token into a
   project file, issue, log, command argument, or agent conversation.
5. If authentication is disabled, leave the token-file field empty. Do not
   disable authentication merely to avoid configuring a protected profile.
6. Disconnect and reconnect the bundle after changing the endpoint, token
   file, or Hronaut MCP settings.

A successful Hronaut health response proves that the local listener is ready;
it does not prove that a graphical MCPB host installed or exposed the tools.
After reconnecting, check the host's tool list for Hronaut and make one bounded,
benign call such as `browser_status`. For a first browser workflow, create a
disposable workspace, open a synthetic page such as `https://example.com`, and
read it with `browser_snapshot`. Remove the disposable workspace afterward.

The adapter requires Node.js 22 or newer and accepts only `http` or `https`
URLs on `localhost`, `127.0.0.0/8`, or `::1`. It rejects URL credentials,
fragments, different request destinations, and redirects. It reads only the
token file explicitly selected by the user and validates the bounded contents
before connecting; it never scans a Hronaut profile. Connection errors are
intentionally bounded and do not print protocol bodies, page content,
endpoints, token-file paths, or tokens.

The MCPB format does not itself make a loopback server reachable from hosted
agents. Use a local client on the same machine as Hronaut.

## Maintainer validation

Run the focused adapter and package tests during development:

```bash
npm test -- tests/mcpb-adapter.test.ts tests/mcpb-packaging.test.ts
```

Run `npm run package:mcpb` to produce both files in `dist/`. The release
workflow builds the bundle after validation, uploads both files with the
platform packages, includes them in `hashes.txt`, and attests them before the
draft release is published. After the public release is verified, the Registry
workflow checks those exact assets and their attestations, publishes the
release metadata with GitHub OIDC, and verifies public Registry readback.

Offline tests validate the bundle manifest against MCPB schema 0.3 pinned from
the official repository at commit
`257af308122753c311825523d19e8c939aeaccc5`, and validate Registry metadata
against the official dated `2025-12-11` server schema. Update these copies only
after reviewing the upstream schema changes and adapting the tests and release
contract together.
