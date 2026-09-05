# Published release history artifact

`release-history.json` is a release asset generated from the canonical GitHub REST release list plus the current candidate's validated final release notes. It is created before `hashes.txt` and asset attestations, uploaded with all other assets to the draft, and becomes public only when the complete release is published. It is never added to an already published release.

This gives hronaut.dev recent published history when GitHub returns 403 to Cloudflare's unauthenticated API requests. Publication automatically advances GitHub's public latest-release redirect to the new artifact. No website rebuild, cross-repository token, or runtime GitHub secret is required.

## Version 1 format

```json
{
  "schemaVersion": 1,
  "tag": "v1.11.55",
  "generatedAt": "2026-09-05T00:00:00.000Z",
  "truncated": false,
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

The generator retains the newest 200 entries including the candidate. It stops safely when that cap is reached before upstream history is known to be exhausted and emits `truncated: true` plus `olderHistoryUrl: "https://github.com/hronaut/hronaut/releases"`. When upstream history is exhausted within the cap, `truncated` is false and the URL is omitted. Traversal itself is bounded to 20 upstream pages of 100 items; if that bound is reached, truncation is explicit rather than blocking publication. This also handles repositories with many drafts or prereleases.

Each note is limited to 16 KiB of JSON-encoded UTF-8, including escapes and surrounding quotes. Clipping retains whole Unicode code points and appends an ellipsis; each entry's existing GitHub link opens the full release notes. This guarantees that 200 legitimately long notes still fit the 4 MiB artifact budget. Titles remain bounded to 120 characters, and incoming API pages are streamed with a 20 MiB limit before JSON parsing. Duplicate retained versions, substituted URLs, invalid dates, and unavailable upstream responses remain errors; historical growth is not an error. The workflow's existing `GITHUB_TOKEN` is used only in authenticated generation requests and is never included in the asset or errors.


## Website consumer

The sibling hronaut-page change keeps REST primary. On the initial history request's failure, it resolves the actual latest published release through the existing resolver (which already has a non-API path), then fetches `/releases/download/<resolved-tag>/release-history.json`. The artifact tag must match that published tag. A missing asset on older releases continues to return the truthful unavailable response.

Fallback responses include `snapshot: <tag>`, `generatedAt`, and explicit truncation metadata. When truncated, the UI links to older history on GitHub. The UI labels the undated first item **Latest release** and identifies the release containing the recent history. Later pages send `snapshot=<tag>`, bypassing REST offsets. If publication has advanced, the server returns 409 and the reader retries from page 1. A browsing session that began with REST sends `source=api`; it never silently appends an older snapshot page. Server pagination is 10 records per page, up to 20 pages. Page 20 has `hasMore: false`; older history is accessed through the explicit GitHub link rather than an unsupported page 21. Artifact caching is version-specific; latest-publication resolution retains its existing short cache.

## Rollout and verification

1. Review and ship the generator/workflow change in a future immutable desktop release; do not modify v1.11.54 or other existing published assets.
2. Verify the added asset is included in `hashes.txt` and GitHub artifact attestations. Existing platform package assets remain unchanged; the total release asset count increases by one.
3. Deploy the independently tested website consumer through staging, its QA gate, and production. It is safe before the first supporting desktop release, but cannot repair a cold-edge history outage until that release exists.
4. Verify a live publication resolves to the new bounded history. In a controlled local handler test, force both REST endpoints to 403 and verify every retained page, the 201+ release cap, undated-current rendering, the older-history link, and exact snapshot identity. Do not modify production responses to simulate failure.

After subsequent publication, the new immutable artifact automatically replaces the previous fallback. Restored REST access immediately remains usable for new readers. History edited or deleted on GitHub after artifact creation is reflected by REST, while fallback is explicitly the immutable history included with its release; the next publication regenerates it.
