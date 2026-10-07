# CopyOTP Implementation Plan

## Goal

A lightweight Chrome extension that finds a one-time login code in a recent
Gmail message, lets the user copy it, and keeps them on the login page. Gmail
does not need to be open. All extraction and matching run locally; network
requests go directly to Google for authorization and Gmail access.

First version: Chrome, Gmail, one connected account, English login emails.

## User Flow

1. The user connects Gmail from the extension popup and grants read-only access.
2. On a login page, the user requests a code using the site's existing flow.
3. The user clicks the CopyOTP toolbar icon. The popup checks recent mail.
4. The popup shows a code, sender, subject, and received age with a Copy button.
5. The user clicks Copy, closes the popup, and pastes into the login form.

If several messages or codes are plausible, show a small list for the user to
choose from. Never silently copy a guessed code. If nothing has arrived, show
an empty state with Refresh and a user-started "Wait for code" action.

The wait action checks every five seconds for up to one minute while the popup
remains open. Stop on a result, timeout, authentication failure, or popup close.
Do not continuously monitor the inbox between uses.

## Email Access Decision

Use the official Gmail API, authorized through `chrome.identity.getAuthToken`.
Chrome manages the access-token cache. No backend, embedded client secret,
email forwarding, or separate CopyOTP account is needed.

Request `https://www.googleapis.com/auth/gmail.readonly`. Gmail has no
OTP-only scope, and its metadata scope cannot read message bodies. The grant
allows reading the entire mailbox even though CopyOTP will only request recent
messages. State that distinction clearly before connection.

This is a restricted Google scope. Plan Google OAuth verification before public
distribution, as well as Chrome Web Store review. A local-only architecture
does not remove the OAuth verification requirement. Start development with an
OAuth project, stable extension ID, and explicitly configured test users.

Inbox DOM scraping is an alternative prototype, but requires a Gmail tab and
can only extract codes present in the rendered subject or preview unless it
also navigates messages. It cannot reliably satisfy this version's goal.

Sources: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
and [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity).

## Architecture

- Manifest V3 extension with a small popup and an event-driven service worker.
- Plain TypeScript, HTML, and CSS; a small build tool such as esbuild.
- Native `fetch` for Gmail requests; no Gmail SDK or UI framework required.
- Popup owns display, clipboard writes, and the bounded wait timer.
- Service worker owns authorization, bounded API calls, and message retrieval.
- A pure extraction module accepts normalized message text and returns candidates.
- HTML-only email text is normalized in an inert document in the popup; email
  HTML is never inserted into the live UI or allowed to load remote resources.
- Use a small established parser if fixtures demonstrate a need for complex
  MIME/header decoding; do not build a general-purpose mail client.

Suggested files:

```text
manifest.json
src/background.ts
src/gmail.ts
src/extract.ts
src/normalize.ts
src/popup.ts
src/popup.html
src/popup.css
tests/fixtures/
tests/extract.test.ts
```

The first working version needs `identity`, `clipboardWrite`, and host access
to `https://gmail.googleapis.com/*`. Add `storage` only for saved preferences.
Add `activeTab` only when implementing local site-aware ranking; read the
hostname after the toolbar click and discard paths and query strings.

Do not request broad website access, clipboard reading, mail modification,
content-script injection, or background notification permissions for the MVP.

Sources: [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list)
and [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

## Retrieval and Extraction

1. Query messages received in the last five minutes, excluding spam and trash.
   Include read messages and archived mail so inbox rules do not break retrieval.
2. Limit each scan to 20 messages. Fetch structured message payloads and inspect
   receipt timestamps, subjects, and text parts. Do not download attachments.
3. Decode base64url text with correct character handling and recursively traverse
   multipart payloads. Prefer plain text; fall back to normalized HTML text.
4. Extract 4-8 digit sequences with boundaries and nearby language such as
   "verification code", "one-time code", "security code", or "sign-in code".
   Preserve leading zeros. Initially defer general alphanumeric code support.
5. Reject obvious dates, phone numbers, prices, order IDs, tracking numbers,
   quoted old messages, and numbers without login-code context.
6. Score using nearby code language, subject context, and recency. Deduplicate
   the same code repeated in plain text and HTML.
7. Optionally boost an explicit sender/site match, but treat that match as a
   convenience hint, not proof of authenticity. Delegated login services can
   use a different sender domain. Use a public-suffix-aware library if comparing
   registrable domains; avoid splitting on the last two hostname segments.
8. Show ambiguous candidates for selection. A five-minute cutoff is a freshness
   rule, not proof the code remains valid. Display received age, not an invented
   expiration countdown.

Query by time rather than a fixed list of English subject keywords so unusual
templates are still retrieved. Sort candidates locally by timestamp and score;
do not assume the list endpoint's ordering is a contract. If the scan limit is
reached, offer an explicit additional scan rather than implying complete coverage.

Sources: [messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
and [message payloads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages).

## Local Data and UI States

- Keep email bodies and codes only in temporary memory during the scan and popup
  session. Discard them after processing or closing; do not persist code history.
- Let Chrome manage OAuth tokens. Never store tokens in preferences or sync them.
- Persist only preferences if needed, locally. Do not log bodies, codes, or tokens.
- Validate extension messages and render subject/sender values as text.
- Clipboard writes happen only on Copy. Confirm success only after the write
  resolves; if blocked, leave the selectable code visible for manual copying.
- Clipboard contents can outlive the popup and may be retained by OS clipboard
  managers. Do not promise deletion or automatically overwrite later clipboard
  contents.
- Provide disconnected, checking, waiting, found, ambiguous, empty, offline,
  reconnect-required, rate-limited, and copy-failed states.
- Refresh replaces the prior result only when the new scan completes; show scan
  status and recheck freshness before allowing a copy of an old result.
- Disconnect clears local state and cached tokens. Provide a way to revoke the
  Google grant; clearing a token cache alone is not grant revocation.

Use short request timeouts, deduplicate overlapping scans, and back off on rate
limits. Keep requests bounded so worker suspension is harmless; popup-driven
timers end when the popup closes. No perpetual service-worker timer is required.

Source: [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Build Sequence

1. **Access proof:** Load an unpacked extension, configure the OAuth client, read
   a recent test email directly from Gmail, and confirm it remains unread.
2. **Extractor:** Implement normalization and conservative numeric extraction
   against synthetic or redacted fixtures before using it in the popup.
3. **Usable MVP:** Build connection, scan, candidate display, Copy, Refresh,
   disconnect, and the primary failure states.
4. **Refinement:** Add bounded waiting, optional site ranking, accessibility,
   rate-limit handling, and a clear local-data permission explanation.
5. **Release:** Finish OAuth verification, privacy disclosures, permission review,
   store packaging, and a clean-profile installation check.

## Acceptance Checks

- With Gmail closed, receive a test login email and copy its code from the popup.
- Pasting preserves the exact code, including leading zeros.
- Handle plain text, HTML-only, multipart, repeated codes, quoted old codes,
  multiple numbers, multiple login emails, and messages without a valid code.
- Do not modify message labels, mark mail as read, or expose message HTML.
- Exercise denied/revoked access, token expiry, offline mode, throttling, popup
  close during a request, wait timeout, and service-worker restart.
- Confirm requests go only to Google and no bodies, codes, or tokens are written
  to persistent extension storage or logs.
- Confirm there is no ongoing polling when the popup is closed and that every
  ambiguous result requires a user choice.
- Measure scan latency and package size on representative fixtures. Initial
  targets: under three seconds for a typical scan on a healthy connection and
  under 250 KB of shipped extension code/assets, excluding development tools.

## Later

After the core flow works: Outlook, additional Gmail accounts, alphanumeric
codes, a keyboard shortcut, and explicit user-triggered field filling. Each
provider needs its own authorization and retrieval implementation. Keep the
extractor shared; avoid new provider abstractions until a second provider exists.
