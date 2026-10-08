# Changelog

## 0.2.2

- Detect Brave desktop and use a separate client-side Google web OAuth flow.
- Validate callback destination, state, token lifetime, and Gmail-only scope.
- Keep Brave access tokens in browser-session memory only; clear on disconnect
  and require explicit reconnect after expiry or restart.
- Add `configure -- --brave`, Brave-specific setup guidance, and an isolated
  Brave extension smoke test. Preserve Chrome's native OAuth behavior.
- Update privacy disclosures and the shared-AlexWorks publication checklist.

Live Brave access requires an additional Web application OAuth client configured
for the extension's HTTPS callback. Google verification and store publication
are separate from this source release.
