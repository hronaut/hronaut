# Workspace site access

Hronaut workspaces are unrestricted by default. A person can instead open the trusted workspace editor and choose **Only listed sites** to constrain every top-level navigation in that isolated workspace. Coding agents and website content can use the resulting policy, but they cannot change it.

## Rule formats

Enter one rule per line:

- `https://app.example` allows one exact HTTP(S) origin, including its explicit non-default port when present.
- `*.example.com` allows HTTP or HTTPS subdomains at a real hostname boundary. It does not allow the apex `example.com` or suffix attacks such as `api.example.com.evil.test`.
- `https://*.example.com:8443` constrains a subdomain wildcard to one scheme and port.
- `http://localhost:*` allows any port on that loopback host. Port wildcards are rejected for non-loopback hosts.

Rules cannot contain credentials, paths, queries, fragments, privileged schemes, or ambiguous multiple wildcards. Internationalized hostnames are stored in canonical ASCII form. `about:blank` remains available as a neutral document so a newly created or newly restricted workspace always has a safe page.

## What is enforced

The main process applies the same parsed policy to direct toolbar and MCP navigation, new tabs, HTTP redirects, page links and forms, popups, and back/forward history. Changing a workspace to a restricted policy replaces any currently open disallowed top-level page with `about:blank`. The policy survives application restart and workspace archive/restore.

Blocked direct requests return an origin-only error. Page-driven attempts remain on the current page. Hronaut keeps at most 50 local audit entries per workspace with the target origin, decision reason, source, and time; it never stores the denied path, query, fragment, or embedded credential. The log is available only through trusted Hronaut chrome and follows the workspace through archive, restore, and restart.

## Security boundary

Site access is a navigation guard, not a network firewall. An allowed page can still fetch resources from other origins, submit background requests, load subresources and frames, or communicate with services permitted by the operating system and network. Use operating-system, container, proxy, or network controls when an agent requires transport-level isolation. Review allowed pages and wildcard scope before reusing an authenticated workspace.
