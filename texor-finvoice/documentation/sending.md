# Sending quotations and invoices

All channels are optional. Every attempt is written to the delivery log on the
document.

| Channel | Setup | What the customer gets |
|---|---|---|
| WhatsApp link | None | A `wa.me` chat with a prefilled message and the document link |
| Gmail | Server: Google OAuth client. Member: "Connect Gmail" | Email from the member's own Gmail, PDF attached |
| SMTP | Workspace: server, username, password | Email from the workspace's mail server, PDF attached |
| WhatsApp Business | Workspace: Meta phone-number ID, token, approved template | A template message with the PDF itself |

Customer links (`/d/:token`) show the document, a PDF download and — while money
is owed and a UPI ID is set — a UPI pay button.

## Gmail

Finvoice asks for `gmail.send` only; it cannot read mail. Google classifies
that scope as *sensitive*, not *restricted*: publishing needs Google's free app
verification but no paid security assessment. Until verified, up to 100 test
users can connect.

1. Google Cloud → create an OAuth client (Web application).
2. Authorised redirect URI: `https://<api>/api/integrations/gmail/callback`.
3. Enable the Gmail API; add the `gmail.send` scope to the consent screen.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

Refresh tokens are stored AES-256-GCM encrypted with `ENCRYPTION_KEY`.

## WhatsApp Business (Cloud API)

The business connects **its own** Meta account; Texor holds no Meta
credentials. Create a *utility* template with a **document header** and three
body variables — customer name, document label and number, total — and enter
its name once Meta approves it. Meta charges the business per message.

## Why these are allowed

Texor products avoid depending on outside services. These integrations are the
exception the product owner asked for: each is off until configured, nothing
else depends on it, and the always-available WhatsApp link means sending never
requires one.
