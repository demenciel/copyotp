# Contributing to CopyOTP

Contributions are welcome through issues and pull requests. CopyOTP is licensed
under MIT. Please keep changes focused and preserve its client-only design.

## Local development

1. Fork the repository and clone your fork.
2. Install Node.js 24, then run `npm ci`.
3. Run `npm run build` and load `dist` in Chrome or Brave as an unpacked extension.
4. To test live Gmail, create your own testing OAuth project/client as described
   in [README.md](README.md). Do not use another contributor's OAuth identity.
5. Create a branch, make your change, and add focused tests.
6. Run the commands below before opening a pull request.

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:extension
# When Brave is installed (or BRAVE_PATH is set):
npm run test:brave
```

An optional GitHub Actions workflow is provided in `docs/ci.yml`. The initial
publisher token does not have the `workflow` scope, so it is intentionally a
template, not an active workflow. To enable CI, add its contents as
`.github/workflows/ci.yml` using GitHub's web editor or a token authorized for
workflow changes. No repository secrets or live OAuth credentials are needed.

## What to include in a pull request

- A short explanation of the behavior being changed and why.
- Tests for the change; UI screenshots with synthetic data for UI work.
- Privacy and permission implications, if any.

Never commit `config.local.json`, OAuth tokens, private keys, live email content,
real OTPs, screenshots with private account data, or your Chrome profile.
Use synthetic email fixtures only. Do not add telemetry, remote scripts,
server-side mail processing, automatic copying, or automatic form submission.
New permissions or broader OAuth scopes require explicit maintainer review.
Chrome OAuth tokens remain browser-managed. Brave access tokens belong only in
trusted `chrome.storage.session` memory, never local/sync storage, logs, or files.

Useful contributions include extraction fixtures, accessibility, translations,
UI polish, and reliability tests. A GitHub fork does not inherit a verified
OAuth app or a Web Store identity; distributing a fork requires its own setup.

## Reporting issues and security concerns

Use public issues for non-sensitive bugs and feature requests. Strip private data
from logs. Report vulnerabilities privately using GitHub's **Security > Report
a vulnerability**, when enabled. Do not post real codes or mailbox contents in
an issue or send them to the maintainer.
