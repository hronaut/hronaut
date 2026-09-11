# Hronaut MCPB adapter

The Hronaut MCPB adapter connects a client's local stdio transport to the
Streamable HTTP endpoint owned by the running Hronaut desktop application. It
does not contain a browser, start Hronaut, copy browser profiles, or accept a
license on the user's behalf.

The adapter is tested on Linux, macOS, and Windows, then built from the same
immutable release tag as the desktop app. Its version therefore matches the
Hronaut release. Each release contains:

- `hronaut-mcp-adapter-<version>.mcpb`, the MCPB 0.3 bundle; and
- `hronaut-mcp-server.json`, the matching MCP Registry metadata with the exact
  release URL and SHA-256 of that bundle.

## Setup

1. Install and start the matching Hronaut desktop release.
2. Open Hronaut Home and copy the current MCP endpoint.
3. If MCP authentication is enabled, copy the token locally into the bundle
   host's sensitive **Hronaut MCP token** field. Do not paste it into a project
   file, issue, log, or command argument.
4. Install the `.mcpb` file in a client that supports MCPB 0.3 and set the
   **Hronaut MCP endpoint** field to the loopback URL from Hronaut Home.
5. Reconnect the client after changing the endpoint, token, or Hronaut MCP
   settings.

The adapter requires Node.js 22 or newer and accepts only `http` or `https`
URLs on `localhost`, `127.0.0.0/8`, or `::1`. It rejects URL credentials,
fragments, different request destinations, and redirects. It never scans a
Hronaut profile for a token. Connection errors are intentionally bounded and
do not print protocol bodies, page content, endpoints, or tokens.

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
draft release is published. Registry publication should use the exact
`hronaut-mcp-server.json` asset from that release.

Offline tests validate the bundle manifest against MCPB schema 0.3 pinned from
the official repository at commit
`257af308122753c311825523d19e8c939aeaccc5`, and validate Registry metadata
against the official dated `2025-12-11` server schema. Update these copies only
after reviewing the upstream schema changes and adapting the tests and release
contract together.
