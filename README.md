# privacymagic-backend

Cloudflare Worker that accepts a problem report from the Privacy Magic extension and emails it to reports@privacymagic.com. It also hosts the uninstall feedback page at `/uninstall`.

## Request

`POST /` or `POST /report` with `Content-Type: application/json`:

```json
{
  "description": "The video player stays blank.",
  "email": "person@example.com",
  "website": "theguardian.com",
  "type": "problem"
}
```

`description` is required and limited to 10,000 characters. `email` is optional, limited to 254 characters, and used only as the message's Reply-To. `website` is optional and must be a hostname, which is what the extension sends when "include website" is checked. Omit either optional field, or send an empty string, to leave it out. `type` is optional and defaults to `"problem"`; send `"uninstall"` from the uninstall feedback page (website is ignored for that type).

Browser requests must come from a `chrome-extension://` or `moz-extension://` origin, or from `https://reports.privacymagic.com` (the uninstall page). Requests with no `Origin` header, such as curl, are accepted.

A successful response is `200` with `{ "ok": true }`.

## Uninstall page

`public/uninstall.html` is served as a Workers static asset at `/uninstall` (shown after the extension is removed). Submissions use `type: "uninstall"`.

## Email

The message is plain text, from `noreply@reports.privacymagic.com`, to `reports@privacymagic.com`. The email binding is restricted to that recipient and sender, so this public endpoint cannot mail anyone else. The visitor's address is never the From address.

The client IP is used only as a rate-limit key (5 requests per minute per address, per Cloudflare location). It is not included in the email.

## Deploy

1. Onboard `reports.privacymagic.com` in [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) so `noreply@reports.privacymagic.com` is allowed to send.
2. Make sure `reports@privacymagic.com` can receive mail.
3. Install dependencies, log in, and deploy:

```sh
npm install
npx wrangler login
npm run deploy
```

`npm run dev` simulates sending and does not deliver mail. `npm test` checks validation and the request handler.

## License

[GPL-3.0-or-later](LICENSE).
