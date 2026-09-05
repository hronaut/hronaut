# Published release history artifact

`release-history.json` is a release asset generated from the canonical GitHub REST release list plus the current candidate's validated final release notes. It is created before `hashes.txt` and asset attestations, uploaded with all other assets to the draft, and becomes public only when the complete release is published. It is never added to an already published release.

This gives hronaut.dev a complete history when GitHub returns 403 to Cloudflare's unauthenticated API requests. Publication automatically advances GitHub's public latest-release redirect to the new artifact. No website rebuild, cross-repository token, or runtime GitHub secret is required.

## Version 1 format

```json
{
  "schemaVersion": 1,
  "tag": "v1.11.55",
  "generatedAt": "2026-09-05T00:00:00.000Z",
  "releases": [
    {
      "version": "1.11.55",
      "title": "Hronaut 1.11.55",
      "url": "https://github.com/hronaut/hronaut/releases/tag/v1.11.55",
      "publishedAt": null,
      "notes": "### Fixed\n\n- Example change."
    }
  ]
}
```

The version above is illustrative, not a publication claim. The first entry is the prepared current release. Its publication time is unknown while drafting, so `publishedAt` is **null**. `generatedAt` is an artifact creation timestamp and must never be presented as the publication date. All subsequent entries come from already published stable GitHub releases, with their actual publication timestamps. Drafts and prereleases are excluded; tag-only entries are never read from Atom or CHANGELOG.

The generator exhausts GitHub pagination, rejects duplicate versions (including an already published candidate), verifies exact repository/tag URLs, normalizes bounded titles and notes, and fails the candidate instead of publishing partial history. Limits are 200 entries including the candidate, 48,000 characters of notes per entry, 120 title characters, and 4 MiB serialized JSON. Reaching a limit is an explicit release failure requiring a reviewed format/pagination extension. Request failures do not reuse a stale manual snapshot. The workflow's existing `GITHUB_TOKEN` is used only in authenticated generation requests and is never included in the asset or errors.

## Website consumer

The sibling hronaut-page change keeps REST primary. On the initial history request's failure, it resolves the actual latest published release through the existing resolver (which already has a non-API path), then fetches `/releases/download/<resolved-tag>/release-history.json`. The artifact tag must match that published tag. A missing asset on older releases continues to return the truthful unavailable response.

Fallback responses include `snapshot: <tag>` and `generatedAt`. The UI labels the undated first item **Latest release** and identifies the release containing the complete history. Later pages send `snapshot=<tag>`, bypassing REST offsets. If publication has advanced, the server returns 409 and the reader retries from page 1. A browsing session that began with REST sends `source=api`; it never silently appends an older snapshot page. Server pagination is 10 records per page, up to 20 pages. Artifact caching is version-specific; latest-publication resolution retains its existing short cache.

## Rollout and verification

1. Review and ship the generator/workflow change in a future immutable desktop release; do not modify v1.11.54 or other existing published assets.
2. Verify the added asset is included in `hashes.txt` and GitHub artifact attestations. Existing platform package assets remain unchanged; the total release asset count increases by one.
3. Deploy the independently tested website consumer through staging, its QA gate, and production. It is safe before the first supporting desktop release, but cannot repair a cold-edge history outage until that release exists.
4. Verify a live publication resolves to the new complete history. In a controlled local handler test, force both REST endpoints to 403 and verify all pages, undated-current rendering, and exact snapshot identity. Do not modify production responses to simulate failure.

After subsequent publication, the new immutable artifact automatically replaces the previous fallback. Restored REST access immediately remains usable for new readers. History edited or deleted on GitHub after artifact creation is reflected by REST, while fallback is explicitly the immutable history included with its release; the next publication regenerates it.
