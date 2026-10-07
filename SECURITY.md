# Security Policy

The current `main` branch is supported. Security fixes will be prioritized over
new features. This is an early-stage extension, not a replacement for a password
manager or hardware security key.

Please report vulnerabilities privately through GitHub's **Security > Report a
vulnerability** feature. If that option is unavailable, open a minimal issue
asking for a private reporting channel without including exploit details or
personal data.

Reports should use synthetic emails, not real codes, access tokens, account
addresses, or email bodies. Include reproduction steps and the affected version.

The threat model assumes the browser, OS, and clipboard are trusted. A sender
name is not proof of authenticity. CopyOTP never opens login pages, auto-fills
forms, or submits codes. Clipboard history tools may retain copied codes.
