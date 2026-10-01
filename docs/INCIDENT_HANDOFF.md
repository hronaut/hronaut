# Incident handoff checklist

A reviewed incident HTML file can be read offline, but does not contain a runnable
application or every fact needed to reproduce a failure. Send a short companion
note when setup or safe replacement inputs are missing. Review the note and any
attachments separately from the package before sharing; the package's replacement
rules and artifact hashes do not cover them.

Use this checklist alongside the [incident package review](../REFERENCE.md#human-reviewed-local-incident-package):

- **Application and setup:** identify the affected app/build separately from the
  Hronaut version. Give authorized recipients a runnable artifact or repository
  revision, prerequisites, working directory, startup command, URL and a readiness
  signal. State any required local configuration without including credentials.
- **Reset and scope:** describe the initial state and how to restore it. Use a
  disposable test environment; state any writes or other side effects. Do not
  direct recipients to reset production data or reuse a private browser profile.
- **Safe inputs:** map each redacted step to a synthetic value or named test
  resource. For generated Playwright exports, identify the corresponding
  `HRONAUT_REPRO_INPUT_<step>` variable. Verify that the substitute reproduces the
  relevant behavior; otherwise label that limitation. Supply credentials through
  the recipient's approved local setup, never in the note or export.
- **Steps and observation:** list the actions, expected result and an observable
  completion condition with a bounded timeout. Separate the intended result from
  what was actually observed. Mark facts added by the author, unavailable evidence
  and unverified explanations; a failed checkpoint alone does not identify a cause.
- **Review and verification:** identify the accompanying file and, if useful, its
  hash. Check URLs, paths, free text and attachments for private data. State which
  instructions were tried, on which build, and whether an independent recipient
  reproduced the result or only reviewed the instructions. Hashes establish byte
  integrity, not anonymization, completeness or correctness.

## Example companion note

Adapt every placeholder before sharing. This is an illustrative disposable app,
not a command to run against a real service.

```text
Evidence: incident.html, SHA-256 <hash>. App: <name and revision>.
Setup: obtain <approved runnable artifact>; install <prerequisites>.
From <directory>, run <startup command>. Open <local URL> only after
<readiness signal>. Configuration: <non-secret test settings>.
Reset: <disposable-state reset command or UI steps>. Side effects: <test writes>.

Input: Repro step 3 is redacted. Use "Demo item";
HRONAUT_REPRO_INPUT_3="Demo item" for the accompanying Playwright export.
The author verified this substitute on <build>, or: substitution is unverified.
Actions: enter the name, then click Create item once.
Wait: <specific request/UI completion signal>, at most <timeout>.
Expected: status text "Item created". Observed: <actual result and its source>.
Reset before retrying. Missing evidence: <known omissions>.

Verification: <commands/actions actually checked, date and result>.
Review status: <author review / independent instruction review / reproduced>.
```

Keep the note separate from the frozen export so its bytes and integrity evidence
remain unchanged. If the recipient still cannot reproduce the issue, first
identify the missing setup or observation; do not assume broader automatic capture
or sharing sensitive request bodies is necessary.
