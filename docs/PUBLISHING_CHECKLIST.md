# Public copy publishing checklist

Use [`PUBLIC_FACTS.json`](PUBLIC_FACTS.json) as the canonical, versioned source
for current Hronaut pricing, trial, license name, setup links, supported desktop
platforms, and built-in client guides. `LICENSE` remains authoritative for legal
rights and restrictions; the fact set keeps public summaries aligned with it.

Before publishing a release announcement, directory entry, community post, or
other launch copy:

1. Confirm the fact-set version and review date are current. Change both in the
   same pull request as any pricing, licensing, platform, or client change.
2. Compare every factual claim with the fact set. For a draft stored in a file,
   run `npm run check:public-copy -- path/to/draft.md`. The command also checks
   current repository surfaces and rejects known superseded terms.
3. Link setup instructions to the canonical setup URL or the matching client
   guide. Use the public download and repository URLs from the fact set.
4. Confirm platform and architecture claims match the release artifacts that
   will actually be published.
5. Preview the final rendered copy and verify every link. Record the fact-set
   version, reviewer, date, and publication URL in the release or publishing
   notes.
6. Remove credentials, bearer values, account identifiers, private URLs, page
   content, and unrestricted transcripts before review or publication.

For an existing post with obsolete claims, edit it and verify the public result
when the platform permits. If it cannot be edited, keep an entry under
`historicalPublications` in the fact set, label the post as historical wherever
Hronaut controls the surrounding link, and direct readers to the canonical
homepage or fact set. Never claim that an external post was updated without
reading the published result.
