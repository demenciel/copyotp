# CopyOTP Privacy Policy

Effective date: October 8, 2026. Publisher: AlexWorks / demenciel.

## Access and purpose

CopyOTP requests Google's `gmail.readonly` scope to find recent numeric login
codes in your Gmail. This scope permits reading your mailbox; CopyOTP limits
each scan to recent messages from the last five minutes, at most 20 per page.
Your click can request another page or wait for new messages. CopyOTP reads the
email address, sender, subject, received time, and email content needed for this
purpose. Attachments are not fetched. It does not send, delete, modify, or mark
messages as read.

## Processing, storage, and sharing

Email content and codes are processed on your device and held temporarily in
memory. The popup's data is discarded when it closes. Chrome manages its OAuth
token cache. On Brave, CopyOTP holds a short-lived OAuth access token in
`chrome.storage.session`, browser memory that survives service-worker restarts
but is cleared on browser restart, extension reload/update/disable, or disconnect.
It stores no refresh token or client secret. Tokens are not written to persistent
extension storage. The extension persists only a boolean
indicating that you explicitly connected Gmail. It does not persist email
addresses, messages, codes, or message history.

CopyOTP communicates directly with Google's OAuth and Gmail services using HTTPS. No mailbox
data or tokens are sent to AlexWorks, GitHub, analytics providers, AI services,
or any other developer-controlled server. No data is sold, used for advertising,
used to train models, or accessed by the publisher. There is no backend,
telemetry, remote executable code, or login-page tracking.

A selected code is written to your clipboard only after you click Copy. Your
operating system or clipboard manager may retain it after the popup closes.
CopyOTP cannot erase clipboard history held by other software.

## Your controls

Disconnect Gmail stops future scans and clears browser-managed tokens and the
Brave session token for this
extension. To revoke Google's underlying permission, use Manage access and
remove the applicable app in Google Account Connections. If the OAuth consent
screen says AlexWorks, revoking that shared app may affect other AlexWorks
products using the same Google Cloud project. Disconnecting CopyOTP is not a
promise that the Google grant has been revoked. Uninstalling removes its local
extension preference; clear clipboard history separately if needed.

## Google Limited Use

CopyOTP's use and transfer to any other app of information received from Google
APIs will adhere to the Google API Services User Data Policy, including the
Limited Use requirements. Data is used only for the user-facing code retrieval
and copy workflow described here.

## Contact and changes

For privacy questions, contact the maintainer through
[CopyOTP's GitHub repository](https://github.com/demenciel/copyotp). Do not include
mailbox content, codes, or tokens in public issues. Material changes to data
handling will be documented here and reflected in the extension's disclosures.
