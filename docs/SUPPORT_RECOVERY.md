# Support, recovery, and exit path

Fact set: 2026-09-20.1<br>
Last verified: 2026-09-20

This page is the canonical public operations guide for Hronaut releases built
from the current repository. [`PUBLIC_FACTS.json`](PUBLIC_FACTS.json) is the
machine-readable source for the facts below, and [`LICENSE`](../LICENSE) is
authoritative for legal rights and restrictions.

## Supported setup and support

Hronaut is a local, visible desktop browser for Windows x64, macOS arm64 and
x64, and Linux arm64 and x64. It requires the Hronaut desktop application and a
compatible client that can connect to a local Streamable HTTP MCP server. Copy
the version-matched endpoint and authentication settings from Hronaut Home.
The server listens on loopback only and is not a remote connector.

Current releases are source-available under the Hronaut Subscription and Trial
License. The trial lasts 10 days from the first agent tool call. Continued use
costs USD $4 per named user each month or USD $24 per named user each year,
saving 50% against twelve monthly payments totaling $48. One seat supports up
to three active devices. Confirm these values in
[`PUBLIC_FACTS.json`](PUBLIC_FACTS.json) before repeating them elsewhere.

Report reproducible product problems through
<https://github.com/hronaut/hronaut/issues>. Send licensing, billing, or account
questions to <support@hronaut.dev>. Include the Hronaut version, operating
system, expected behavior, and privacy-safe reproduction steps. Remove tokens,
credentials, account identifiers, private URLs, and page content from reports.

## Preserve or reset a workspace

Archiving a workspace keeps its tabs and isolated browser profile for later
restoration. Permanent deletion removes that workspace and its website data.
Page-level Site controls can clear selected storage without deleting the whole
workspace. Use the application History controls separately for global history.

Portable workspace templates are the supported way to move reviewed setup to
another installation. A template can contain selected workspace names, colors,
and HTTP(S) start pages. Review names and URLs before saving because either can
contain private information. A template does not export cookies, credentials,
saved passwords, or raw private page content. It also excludes local storage,
tokens, workspace IDs, resume keys, site-access rules, permissions, and profile
paths. Import creates fresh profiles with direct agent access disabled.

The human-only Copy and Move controls can transfer selected cookies and local
storage between local workspaces. That operation is local profile maintenance,
not a portable backup or secret export. Saved passwords, IndexedDB, history,
caches, downloads, and permissions are outside that transfer.

After a trial or subscription expires, automation is blocked, but the desktop
application continues to allow manual recovery, export, deletion, and license
management. Expiry does not delete local workspace data.

## Replace or reconnect a client

1. Copy the current setup from Hronaut Home into the replacement MCP client.
   If the endpoint, authentication mode, or token changed, replace the old
   values and restart the client. Rotating authentication invalidates existing
   MCP sessions and pending dispatches.
2. Resume only the intended agent-owned workspace with its stable workspace ID
   and private resume key. A workspace name is a human label and grants no
   access. If the resume key is unavailable, create a fresh workspace or use a
   reviewed portable template; do not copy profile files into another workspace.
3. Before browser-backed work resumes, revalidate the named workspace, profile,
   account, origin, and tab, plus the current navigation and session generation.
   Recheck the current capability policy and any consequential-action approval.
   Navigation, reconnect, policy, sign-in, 2FA, or generation drift can make an
   earlier observation or approval stale.
   A reconnecting transport must also claim the workspace's exclusive write
   lease. If another live transport holds it, `BUSY` means no mutation was
   dispatched; inspect or use a separate workspace instead of retrying blindly.
4. Use visible human takeover when the signed-in account, sign-in or 2FA state,
   target, or outcome is unclear. Inspect current page state before retrying an
   action whose previous result may be unknown.

Pausing MCP from the visible Hronaut window revokes every current write lease.
After resuming, read-only inspection remains available, but each writer must use
`browser_workspaces` with `action: "claim-ownership"` after checking fresh state.
Use `action: "release-ownership"` for an intentional handoff. Disconnect and
authentication rotation also revoke ownership automatically.

Replacing a workspace means creating a new isolated profile. Importing a
template restores reviewed structure and start pages, but does not recreate the
old browser identity or authenticated sessions. Keep the old workspace archived
until the replacement is verified, then delete it from Hronaut when it is no
longer needed.

## Product boundary and exit

Hronaut supplies local browser context, visible automation, bounded approvals,
and human takeover. It is not an OAuth/OIDC provider, identity broker,
enterprise access-control system, or hosted browser fleet. It does not issue an
external identity, exchange provider tokens, define an organization's access
policy, or provide records-retention governance.

To stop using Hronaut, save any reviewed portable templates you need, archive or
permanently delete local workspaces as appropriate, cancel future subscription
renewal through <https://www.creem.io/my-orders/login>, and uninstall the desktop
application. Cancellation and deletion are separate: canceling stops future
billing according to the license, while workspace deletion removes local browser
profiles selected in the application.
