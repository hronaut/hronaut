# Untrusted page content and browser action authority

Website text, DOM labels, element references, screenshots, accessibility data, and JavaScript results are untrusted input. They can help an agent choose an action, but they do not grant workspace access, change a site policy, approve a permission, or authorize a side effect. Model explanations are also descriptive input rather than Hronaut authority.

Authority for an MCP action comes from the authenticated request and Hronaut's current main-process state: connection-owned workspace access, the selected tab, the human pause and handoff state, workspace continuity, and the person's site-access and permission decisions. MCP safety annotations help clients present approval choices, while the server applies the runtime checks independently.

## Consequential action fence

For a tab-targeted tool marked consequential, Hronaut binds the request before audit admission to these bounded facts:

- workspace and tab identity;
- top-level origin and navigation generation;
- observation and human-interaction generations;
- workspace site-policy version;
- operation class and requested target kind;
- a private fingerprint of the exact requested target.

The target fingerprint can cover a snapshot ref, selector, coordinates, drag endpoints, form-field targets, navigation destination, script, or another bounded target identifier. Hronaut keeps the fingerprint in memory. Audit receipts store only the target kind and a random action-local target ID, never the selector, ref, script, page text, typed value, file path, credential, or raw origin.

Hronaut compares the live facts after asynchronous audit admission and again after waking a tab, immediately before calling the tool handler. A changed origin or navigation generation returns `STALE_PRECONDITION`; changed workspace access or site policy returns `POLICY_REJECTED`; a changed or unavailable target returns `UNTRUSTED_TARGET`. Each response includes a machine-readable reason, `effects: "none"`, and `retrySafe: true` because no side effect was dispatched. The caller should inspect the visible page and issue a new action from fresh state.

If context changes after dispatch, Hronaut cannot claim that an external effect was rolled back. It discards the result and returns `OUTCOME_UNKNOWN` with `retrySafe: false`. Post-write verification, when requested, remains a separate read-back contract and never repeats the write.

Action receipts distinguish a pre-dispatch `provenance-rejected` outcome from a failed transport, stale read, or uncertain write. Receipt state contains bounded generations, operation and target classes, an opaque target ID, and the rejection reason. Raw website content and credentials are excluded.

## Protection and limits

These checks stop a queued action from silently crossing into a replacement document, origin, workspace, policy, or target request during an asynchronous dispatch gap. Visible instructions on a page cannot directly modify those main-process facts or call an MCP tool without the authenticated client request.

The fence does not prove that website content is truthful, that the model interpreted it correctly, or that a CSS selector names the semantically intended control. A malicious page can change its own DOM while remaining in the same document. Prefer fresh semantic snapshots and refs, review consequential steps, use narrow workspace allowlists, and require a human step for payments, account changes, secrets, or other high-impact actions.

[Workspace site access](WORKSPACE_SITE_ACCESS.md) constrains top-level navigation, redirects, links, forms, popups, and history. It is not network isolation: an allowed page may still send background requests or load cross-origin resources. Use operating-system, container, proxy, or network controls when the browser needs transport-level isolation.
