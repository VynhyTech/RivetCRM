# RivetCRM landing

Static landing page + a tiny Node server (no dependencies, Node 18+).

```
npm start          # http://localhost:10000
npm run check      # syntax-check server and script
```

All site files live in `public/`. `server.js` serves them with security headers, caching and compression, and
exposes `POST /api/contact`.

## Environment variables (Render -> Environment)
| Variable | Purpose |
|---|---|
| `RESEND_API_KEY`, `CONTACT_TO`, `CONTACT_FROM` | Email delivery for the contact form (required) |
| `CLIENT_IP_HEADER` | Header holding the real client IP (default `true-client-ip`) - verify on your deployment |
| `CONTACT_PER_IP_LIMIT` / `CONTACT_GLOBAL_LIMIT` | Rate limits per hour (defaults 10 / 40) |
| `LEADS_FILE` | Optional JSONL copy of leads (needs a persistent disk) |

## Before launch
- Confirm the production domain. `https://rivet-crm.com` is used in `index.html` (canonical, og:url), `robots.txt`
  and `sitemap.xml`; search and replace it if different.
- Replace the placeholder stats and "TBD" pricing, and add real Privacy / Terms pages.
