# Consent Signal

Privacy-first consent and user information dashboard. The tracking link is opaque, and the server does not persist browser/device information until the visitor explicitly consents.

## Run locally

1. Install Node.js 20+ and PostgreSQL 15+.
2. Copy `.env.example` to `.env` and change `JWT_SECRET`, `ADMIN_PASSWORD`, and `FIELD_ENCRYPTION_KEY`.
3. Create a database named `consent_signal`, then run `psql "$env:DATABASE_URL" -f server/schema.sql`.
4. Run `npm install` and `npm run dev`.
5. Open `http://localhost:5173` for the dashboard. Use `Create tracking link` to generate `/track/<opaque-token>`.

To use IP2Location for consented IP enrichment, set `IP2LOCATION_API_KEY` in `.env`. The server requests the visitor's city, region, and country from IP2Location after consent, then displays those fields in the dashboard. `IP2LOCATION_API_URL` can be changed for a compatible endpoint; when no key is configured, the local fallback provider remains available.

The session API also returns selected provider metadata after consent: country code, district, postal code, coordinates, timezone, ASN, ISP, domain, network speed, usage type, proxy/VPN indicators, and fraud score. The metadata is encrypted when `FIELD_ENCRYPTION_KEY` is valid.

The development server falls back to an in-memory store if PostgreSQL is unavailable, so the interface remains usable for local UI work. Production must use PostgreSQL, HTTPS, a strong secret, and a real IP geolocation provider.

## Privacy boundary

The tracking page describes IP address, approximate IP location, optional GPS, and browser/device metadata before showing an explicit `Allow & Continue` action. GPS is requested only after consent and only through the browser permission prompt. The app never reads cookies, local storage, passwords, files, contacts, camera, microphone, or authentication tokens.

## Production notes

- Terminate TLS at the reverse proxy and set `NODE_ENV=production`.
- Replace the demo admin login with SSO or a stronger identity provider.
- Set a production IP geolocation provider and review its data processing terms.
- Use a 32-byte encryption key for `FIELD_ENCRYPTION_KEY`; sensitive values are encrypted before persistence.
- Run the retention job and use the dashboard delete action to honor deletion requests.
