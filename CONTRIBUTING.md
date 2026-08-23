# Contributing to Hronaut

Thank you for helping improve Hronaut. Bug reports, focused design proposals, documentation suggestions, accessibility feedback, and private security reports are welcome.

## Code contributions are temporarily paused

Hronaut uses PolyForm Noncommercial and separate commercial licensing. Hronaut must therefore have sufficient rights to distribute accepted contributions under both models.

Do not open a code pull request until this repository publishes a contributor agreement and reopens code contributions. A Developer Certificate of Origin sign-off alone does not provide the relicensing rights required by this model. Unsolicited patches cannot be accepted or incorporated.

You may still:

- open a focused issue for a reproducible defect or proposal;
- suggest documentation changes in an issue;
- report vulnerabilities privately through [.github/SECURITY.md](.github/SECURITY.md).

Do not submit code, media, fonts, credentials, private website data, or other third-party material in an issue.

## Development

Hronaut requires Node.js 22 or newer.

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run build:website
```

The isolated Docker/Xvfb integration suite is available for browser, Electron lifecycle, MCP, clipboard, and native-dialog validation:

```bash
npm run test:integration:docker
```
