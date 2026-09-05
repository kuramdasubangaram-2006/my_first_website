# OSINT Link Intelligence Dashboard

A consent-first Flask teaching project for demonstrating what a web request exposes, what a browser keeps behind a permission prompt, and how public DNS/RDAP records can be researched. It is designed for local labs and legitimate, authorized demonstrations only.

## Project structure

```text
app.py                    Flask routes, validation, auth, database access
schema.sql                SQLite schema and indexes
wsgi.py                   Production WSGI entry point
requirements.txt          Pinned Python dependencies
.env.example              Configuration template
templates/                Login, dashboard, article, and error views
static/css/app.css        Responsive visual system
static/js/dashboard.js    Admin actions and visitor/domain views
static/js/article.js      Telemetry and explicit GPS/camera controls
deploy/nginx.conf.example Reverse-proxy starting point
```

## Kali Linux installation

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx
cd OSINT-Link-Intelligence-Dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('change-this-password'))"
```

Put the printed value in `.env` as `ADMIN_PASSWORD_HASH`, set a long random `SECRET_KEY`, then initialize and run:

```bash
flask --app app init-db
flask --app app run --host 127.0.0.1 --port 5000
```

Open `http://127.0.0.1:5000/login`. Do not expose Flask's development server to the internet.

## Configuration and IP intelligence

`IP_API_URL` defaults to `https://ipapi.co/{ip}/json/`. Replace it with a contract-approved provider endpoint if needed. API keys belong in `.env` or the hosting provider's secret manager, never in JavaScript or Git. The app skips private/local addresses, times out external calls, and labels provider results as approximate. Provider response fields are expected to include country, region, city, latitude, longitude, ASN, ISP, or organization when available.

Domain analysis uses `dnspython` for A, AAAA, MX, TXT, and NS records and the public RDAP protocol through `rdap.org` for registrar, creation, expiration, and nameserver metadata. Results are public records; this module does not query private WHOIS data or attempt access to protected systems.

## Database schema

`links` stores an opaque generated ID and UTC creation time. `visits` stores the request IP, timestamp, truncated user agent, parsed browser/OS/device, optional browser telemetry, and serialized IP-provider response. `consent_events` stores only GPS/camera grant or denial events and, for GPS, the coordinates explicitly shared by the visitor. Camera images are never uploaded or stored. Foreign keys and indexes are enabled in `schema.sql`.

## Local testing

Generate a link in the dashboard, open it in a second browser/private window, and inspect the visitor record. Test both permission paths: deny GPS/camera and confirm that only `denied` is recorded; grant GPS and confirm the displayed map link; grant camera and confirm no capture occurs until `Capture image` is pressed. The capture remains in the browser and is not sent to the server.

Useful checks:

```bash
python -m py_compile app.py wsgi.py
flask --app app init-db
curl -I http://127.0.0.1:5000/login
```

For production, replace the in-process demonstration rate limiter with a shared Redis-backed limiter or an equivalent WAF/proxy control. It is intentionally small and local for teaching.

## HTTPS and deployment

1. Point a DNS A/AAAA record for your authorized domain to the VPS.
2. Copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/osint-demo`, replace the hostname, enable it, and reload Nginx.
3. Run the app behind Nginx with a production WSGI server:

```bash
source .venv/bin/activate
gunicorn --workers 2 --bind 127.0.0.1:8000 wsgi:app
```

4. Obtain a certificate only for a domain you control:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d demo.example.org
```

5. Set `COOKIE_SECURE=1`, `FLASK_DEBUG=0`, a strong secret, and `ADMIN_PASSWORD_HASH`. Keep SQLite on a protected disk for a small lab; use PostgreSQL with backups for a multi-user deployment. Add a systemd service, firewall rules, log rotation, monitoring, and a shared rate limiter before public use.

Browser geolocation and camera permissions require a secure context in normal deployment. HTTPS is therefore a functional requirement for those demos, not just a deployment nicety.

## Search Console and indexing

This is an admin tool and a fictional article. Keep the dashboard, generated URLs, and visitor records out of search indexes. Do not submit generated tracking links to Google Search Console. If publishing the educational article publicly, add a normal canonical URL and `robots.txt`, verify only a property you control in Search Console, submit that canonical sitemap, and request indexing for the article page only. Never publish visitor data or use Search Console to enumerate visitors.

## Assignment explanation

- **Authentication:** Flask session plus a password hash held in environment configuration.
- **CSRF:** Session token is required for login, logout, link creation, and domain analysis.
- **Input validation:** Domain length/character checks, bounded user-agent and telemetry fields, and allowlisted consent types/statuses.
- **Secure headers:** CSP, frame protection, MIME sniffing protection, referrer policy, and a restrictive permissions policy.
- **Request analytics:** IP and request headers are recorded for the generated demo URL, while browser JavaScript sends screen, language, timezone, referrer, and capability data.
- **IP intelligence:** External provider output is optional, timeout-bounded, and approximate.
- **Domain intelligence:** DNS and RDAP are public, read-only lookups.
- **Permission boundary:** GPS uses `navigator.geolocation`; camera uses `getUserMedia`; both are initiated by visible buttons and handle denial without bypass attempts.
- **Data minimization:** No passwords, camera uploads, hidden GPS requests, credential harvesting, exploit logic, or private-record access are implemented.
