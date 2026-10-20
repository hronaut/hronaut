# Workspace site access

Hronaut workspaces are unrestricted by default. A person can instead open the trusted workspace editor and choose **Only listed sites** to constrain every top-level navigation in that isolated workspace. Coding agents and website content can use the resulting policy, but they cannot change it.

## Rule formats

Enter one rule per line:

- `https://app.example` allows one exact HTTP(S) origin, including its explicit non-default port when present.
- `*.example.com` allows HTTP or HTTPS subdomains at a real hostname boundary. It does not allow the apex `example.com` or suffix attacks such as `api.example.com.evil.test`.
- `https://*.example.com:8443` constrains a subdomain wildcard to one scheme and port.
- `http://localhost:*` allows any port on that loopback host. Port wildcards are rejected for non-loopback hosts.

Rules cannot contain credentials, paths, queries, fragments, privileged schemes, or ambiguous multiple wildcards. A `*` can only start a subdomain rule or stand for the port of a loopback host, so `http://*.localhost:*` and `https://a.*.example.com` are refused. Earlier versions saved rules like these as written, where they never matched a site; they are dropped when Hronaut starts. Internationalized hostnames are stored in canonical ASCII form. `about:blank` remains available as a neutral document so a newly created or newly restricted workspace always has a safe page.

## What is enforced

The main process applies the same parsed policy to direct toolbar and MCP navigation, new tabs, HTTP redirects, page links and forms, popups, and back/forward history. Changing a workspace to a restricted policy replaces any currently open disallowed top-level page with `about:blank` and clears its title and icon: a page that asks before leaving is replaced without asking, a sleeping tab on a disallowed page wakes on `about:blank` instead of keeping that page to wake to, a tab that is waking up is checked once its page opens, and a navigation still under way to a disallowed site is stopped, leaving the page shown before it when that page is allowed. Pages that are allowed keep loading. The policy survives application restart and workspace archive/restore. A workspace created as a copy of another is never looser than its source when it is created: **Only listed sites** rules chosen for the copy apply when the source allows every site or lists each of those rules too, **Any safe website** keeps the source's rules, and any other rule is refused with a message instead of being replaced. Agent forks always inherit the source's policy. Its Site access can be changed afterwards like any workspace's.

Blocked direct requests return an origin-only error. Page-driven attempts remain on the current page. Hronaut keeps at most 50 local audit entries per workspace with the target origin, decision reason, source, and time; it never stores the denied path, query, fragment, or embedded credential. The log is available only through trusted Hronaut chrome and follows the workspace through archive, restore, and restart.

## Security boundary

Site access is a navigation guard, not a network firewall. An allowed page can still fetch resources from other origins, submit background requests, load subresources and frames, or communicate with services permitted by the operating system and network. Use operating-system, container, proxy, or network controls when an agent requires transport-level isolation. Review allowed pages and wildcard scope before reusing an authenticated workspace.
