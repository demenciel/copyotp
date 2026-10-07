# Chrome Web Store: CopyOTP Release Guide

Checked against Google/Chrome documentation on October 7, 2026.

**Two independent approvals are required:** Chrome Web Store review and Google
OAuth verification for `gmail.readonly`. GitHub being public does not make OAuth
public. No guide can guarantee Google's approval or its timing. This checklist
prevents the common packaging, consent, and extension-ID mistakes.

## 1. Decide how AlexWorks will publish

Your current project has one AlexWorks consent screen and four OAuth clients
for different apps. Clients identify integrations; they are not four separate
consent apps. Branding, audience, declared scopes, and verification are shared
at project level. Each client still requests its own runtime scopes. CopyOTP
requests only Gmail read-only; do not add other apps' scopes to its manifest.
Google documents this [cross-client consent behavior](https://developers.google.com/identity/protocols/oauth2/cross-client-identity).

**Current release path: use the existing AlexWorks project.** Your project quota
is full, so creating a new project is not a prerequisite for continuing this
guide. First confirm that the active AlexWorks project is NOT scheduled for
deletion. Preserve its name, all four existing clients,
redirects, and existing scope declarations. Add a *new* Chrome Extension client
for the store ID, leaving the unpacked-development client intact. Clearly list
CopyOTP on AlexWorks' homepage and give it a dedicated privacy-policy section.
Disclose that the Google consent prompt says AlexWorks. Inventory each client,
its product, runtime scopes, and whether data goes through a server. Verification
may require demonstrations for multiple clients; a server-backed product using
restricted data can change the assessment discussion for the shared app. Do not
claim the whole AlexWorks umbrella is client-only. Changing audience to
Production affects the shared consent app, not just CopyOTP. Revoking AlexWorks
access may affect sibling apps. Don't delete or rename another app's client to
make verification easier; plan any migrations separately.

Treat this as one truthfully described AlexWorks product family, not a way to
hide unrelated applications behind a verified client. Explain the relationship
between products in the homepage, policy, and review submission. Google decides
whether that shared arrangement meets its requirements. If Google requires
separate production projects, use the quota-increase route below or wait for
capacity before completing that part of the launch.

**Optional later isolation:** when project capacity becomes available, a
dedicated production project named **CopyOTP by AlexWorks** would give CopyOTP
its own consent/review/revocation boundary. It is not needed to reserve the
Web Store item, prepare assets, or continue testing now, and it does not remove
Gmail verification. Don't migrate or delete sibling apps as part of this guide.

### Project quota and the 30-day deletion window

Projects pending deletion still count toward quota until permanent deletion
after the 30-day recovery window. Scheduling more deletions does not immediately
free slots. [Google's deletion/quota documentation](https://docs.cloud.google.com/resource-manager/docs/delete-restore-projects).

You can request additional capacity through Google's
[project quota increase process](https://support.google.com/cloud/answer/7283050).
For an account without an organization, follow its **Request Project Quota
Increase** form and explain the separate production OAuth project use case.
Approval and turnaround are not guaranteed. Don't use extra accounts or projects
to evade Google's quotas or verification. In the meantime, continue step 2 with
the existing, active AlexWorks project; creating a client there is a different
operation from creating a new Cloud project.

## 2. Register the publisher

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Use the account that should own the extension. Enable Google 2-Step Verification.
3. Register if necessary, complete publisher/contact details, and pay the one-time
   fee shown by Google. Read and accept the developer terms yourself.
4. Choose AlexWorks as the publisher identity where applicable.

Reference: [publisher registration](https://developer.chrome.com/docs/webstore/register).

## 3. Create a draft to obtain the STORE identity

From the repository directory:

```sh
npm ci
npm run check
npm test
npm run package -- --draft
```

1. In the dashboard, click **Add new item** and upload
   `artifacts/releases/copyotp-0.2.0-draft.zip`.
2. **Do not submit this draft for review or distribute it.** It intentionally has
   no OAuth configuration. Its sole purpose is reserving the store item.
3. Record the dashboard's **Item ID**. Do not use the current unpacked extension
   ID unless the dashboard actually matches it.
4. In **Package > View public key**, copy the public key to a local file such as
   `/tmp/copyotp-store-public-key.pem`. Include the PEM headers or use one line
   of base64. It is public, not a secret. Do not use a `.pem` private signing key.
5. Preserve your current local configuration outside the Git repository before
   switching it. For example, `cp config.local.json /tmp/copyotp-dev-config.json`.
6. Import the store key using the *actual* dashboard ID:

```sh
npm run store:key -- /tmp/copyotp-store-public-key.pem STORE_ITEM_ID
```

Replace `STORE_ITEM_ID` with the 32-letter ID. The command refuses a mismatch and
clears the old client ID when the extension identity changes. This prevents an
unpacked OAuth client from silently being reused for the store build.

Reference: [Chrome's store-key and OAuth workflow](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth).

## 4. Bind OAuth to that exact store ID

1. Select the intended production project in Google Cloud, not another app's project.
2. Enable the Gmail API. Configure External audience and add your test Gmail
   account while testing. Keep existing AlexWorks testers if sharing the project.
3. In **Data Access**, declare `https://www.googleapis.com/auth/gmail.readonly`.
   Preserve scopes needed by sibling apps in a shared project.
4. In **Clients > Create client**, choose **Chrome Extension**. Name it
   `CopyOTP - Chrome Web Store`. Set **Item ID** to the store's exact ID. Leave
   the AI-agent classification off; this extension does not use AI or MCP.
5. Copy the generated public client ID and configure it:

```sh
npm run configure -- YOUR_REAL_CLIENT_ID.apps.googleusercontent.com
```

6. In `chrome://extensions`, load/reload `dist`. Confirm the displayed extension
   ID equals the dashboard Item ID and the OAuth client's Item ID. If you have
   both development and store-ID builds loaded, disable the development build
   temporarily so you test the correct one. Don't delete its client or config.
7. Connect Gmail, request a fresh login code with Gmail closed, select the
   matching message, copy, and paste into the login form. Test refresh, wait/stop,
   expired codes, and disconnect. Verify the message remains unread.

Never put a client secret in a Chrome extension. Chrome Extension clients use a
public client ID. The ZIP checker verifies the local key/ID, but you must verify
the OAuth client-to-Item-ID binding in Google Cloud yourself.

## 5. Complete Google's OAuth review

1. Publish a real HTTPS homepage and privacy policy on a domain you control.
   Use [PRIVACY.md](PRIVACY.md) as CopyOTP's policy text, add a monitored support
   contact, and link policy from homepage. Verify the domain in Search Console.
   A GitHub repo is useful for source/support, but is not a substitute for a
   verified app domain. Use the same domain for homepage and privacy policy.
2. Set truthful branding/support links in **Google Auth Platform > Branding**.
   In the shared-project path, keep **AlexWorks** and explain the product suite.
3. Finish brand verification/publishing, then the restricted-scope review in
   **Verification Center**. Follow the console's current prompts. Keep testing
   access until the reviewer-required production transition is appropriate;
   switching to Production alone is not verification.
4. Explain the Gmail scope: email body access is needed to identify numeric login
   codes. Metadata-only access cannot read those codes. No send/modify scope is
   needed. Describe it as a user-facing email productivity tool; Google decides
   whether this use case qualifies under its Gmail policy.
5. Record an unlisted demo video with English consent, the correct client ID,
   a synthetic login email, extraction/copy, and disconnect/revocation. With a
   shared project, include the other clients as requested by Google.
6. Provide the architecture: Chrome -> Google Gmail API over HTTPS -> local
   normalization/extraction -> user-click clipboard. No developer backend, AI,
   telemetry, or stored mailbox data. Ask the review team to confirm whether a
   security assessment is required. Do not assume that client-only processing
   waives OAuth verification. A future server integration changes this analysis.
7. Respond to reviewer emails and wait for approval of the required scope before
   launching to arbitrary Gmail users. Keep your support address monitored.

Sources: [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification),
[verification requirements](https://support.google.com/cloud/answer/13464321),
[Gmail permitted uses](https://developers.google.com/workspace/workspace-api-user-data-developer-policy#appropriate_access_to_and_use_of_gmail_scopes).

## 6. Build the final upload ZIP

Increase `version` in BOTH `package.json` and `manifest.json`, e.g. `0.2.1` for
the configured upload after the `0.2.0` reservation draft. Update the lockfile:

```sh
npm install --package-lock-only --ignore-scripts
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:extension
npm run package -- --id STORE_ITEM_ID
```

Upload `artifacts/releases/copyotp-0.2.1.zip` to the **existing draft item**,
not Add new item. The packager includes only runtime files and LICENSE with
`manifest.json` at the ZIP root. It excludes local config, source/test fixtures,
screenshots, `node_modules`, and private data. It removes the development `key`
field from the store ZIP; `dist` keeps the store public key for local testing.

## 7. Complete the store listing

- Name: **CopyOTP**. Summary: **Copy a recent Gmail login code without opening the email.**
- Category: Productivity, if available. Language: English.
- Description: **CopyOTP by AlexWorks finds recent numeric login codes in Gmail
  and lets you copy the matching code without opening the message. Read-only
  Gmail access, local email processing, and no developer backend or analytics.
  Supports 4-8 digit codes in English emails. Codes are shown with sender and
  age; you choose what to copy. No automatic filling or submission.**
- Support URL: `https://github.com/demenciel/copyotp/issues`.
- Homepage and privacy URL: your public, verified-domain pages from step 5.
- Icon: the built `dist/icons/128.png` (128x128 PNG).
- At least one screenshot: 1280x800 or 640x400, demonstrating the real UI with
  synthetic data, not your Gmail address or real code. Use the ready-made
  `docs/images/store-code.png` (1280x800). It shows the real popup with a synthetic
  email fixture, centered on its dark background. `docs/images/preview.png`
  is a repo preview, not a correctly sized marketplace screenshot.
- Small promotional tile: use `docs/images/store-promo.png` (440x280). It uses
  CopyOTP's own mark, not SpaceX/xAI/Grok names or logos. The visual inspiration
  does not imply affiliation or AI use. Re-running `npm run test:ui` regenerates
  both marketplace assets in `artifacts/` if the UI changes.

References: [listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing),
[image requirements](https://developer.chrome.com/docs/webstore/images).

## 8. Fill Privacy Practices accurately

Single purpose: **Find and copy recent Gmail login codes on the user's device.**

| Permission | Justification to paste |
| --- | --- |
| identity | Obtain a user-authorized Gmail read-only OAuth token through Chrome Identity. |
| storage | Store only whether the user explicitly connected Gmail. No emails, codes, addresses, or tokens are persisted by CopyOTP. |
| clipboardWrite | Copy the user's selected login code after their explicit button click. |
| gmail.googleapis.com host | Fetch the user's recent Gmail messages directly from Google's API for local code extraction. |

Remote code: **No**. Gmail API responses are data, not executable code.

Data disclosures must include what the extension *accesses locally*, not just
what the publisher receives. It accesses email address, email communications,
and one-time authentication codes; review the current form's **Personally
identifiable information**, **Personal communications**, and **Authentication
information** categories and disclose these accurately. It does not collect
financial, health, location, browsing-history, or website-activity data for a
separate purpose. Do not claim "no user data accessed" because there is no
backend. Explain transient on-device handling and direct Google API access.
Certify only statements that are true: no sale, unrelated uses, or creditworthiness
use. Link the privacy policy and ensure listing, policy, and behavior agree.

Reference: [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## 9. Review and launch

1. Provide test instructions: use a consenting Gmail test account, connect through
   OAuth, deliver a synthetic recent verification email, copy the displayed code,
   and confirm the email remains unread. Explain the numeric/English/5-minute
   limits and read-only scope. Don't share personal credentials; use a dedicated
   test account only if reviewers specifically require credentials via their
   secure dashboard. Testing-mode access needs approved testers until verified.
2. Set distribution to **Public**, choose supported countries, and submit for
   review. Disable automatic publishing when OAuth approval is still pending.
3. Resolve review feedback. If a fix changes the package, bump the version,
   rebuild/test/package, and upload to the SAME item.
4. Publish only when BOTH approvals are ready. If choosing deferred publishing,
   watch the dashboard's publication deadline; approved submissions can expire.
5. Install the Web Store version in a clean Chrome profile. Verify consent works
   for a non-tester account, fetch/copy/paste works, and the ID remains correct.
6. Add the store link and approved release version to README/GitHub. Keep issues
   and pull requests open. Repeat checks/version bump for each update.

Reference: [submission and deferred publishing](https://developer.chrome.com/docs/webstore/publish).

## Fast troubleshooting

| Symptom | Check |
| --- | --- |
| 403 access_denied / approved testers only | Correct project audience and tester list; production verification isn't complete. |
| OAuth client error after store upload | Store Item ID, imported public key ID, and Chrome OAuth client Item ID must all match. |
| Gmail API disabled | Enable Gmail API in the project owning the client, not merely another AlexWorks project. |
| Consent says AlexWorks | Expected in the shared-project path; don't silently rename the umbrella. |
| Other app loses Google access | Shared app grant may have been revoked; reconnect that app or isolate projects. |
| No code found | Request a fresh 4-8 digit English numeric code; wait/refresh; check sender; try next page. |
| ZIP rejected | Use the generated ZIP, not a ZIP of the whole repo; version must increase for updates. |
| Google asks for a security assessment | Supply accurate data-flow/client inventory; confirm applicability with reviewers. |

## Launch gate

- [ ] Correct production project chosen; sibling AlexWorks clients preserved.
- [ ] Store ID = imported key ID = production OAuth client's Item ID.
- [ ] Gmail API enabled; required OAuth verification approved.
- [ ] Public homepage/privacy/support URLs work without signing in.
- [ ] ZIP is configured, tested, correctly versioned, and NOT the draft ZIP.
- [ ] Listing assets and data disclosures match actual behavior.
- [ ] Chrome Web Store review approved; distribution Public.
- [ ] Store-installed build works for a new non-tester account.

Do not call the extension marketplace-ready until every launch gate is checked.
