import json
import logging
import os
import secrets
import socket
import sqlite3
import time
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from flask import Flask, abort, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "data", "osint.db"))
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
IP_API_URL = os.environ.get("IP_API_URL", "https://ipapi.co/{ip}/json/")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", secrets.token_hex(32)),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
    MAX_CONTENT_LENGTH=16 * 1024,
)
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)
RATE_WINDOW = 60
RATE_LIMIT = 30
request_counts = {}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_db():
    if "db" not in g:
        os.makedirs(os.path.dirname(DATABASE), exist_ok=True)
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        with open(os.path.join(BASE_DIR, "schema.sql"), encoding="utf-8") as schema:
            db.executescript(schema.read())
        db.commit()


def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(24)
    return session["csrf"]


@app.context_processor
def inject_globals():
    return {"csrf_token": csrf_token()}


def csrf_protected(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if request.form.get("csrf_token") != session.get("csrf") and request.headers.get("X-CSRF-Token") != session.get("csrf"):
            abort(400, "Invalid CSRF token")
        return view(*args, **kwargs)
    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("admin_authenticated"):
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def client_ip():
    # Do not trust forwarded headers unless the deployment explicitly sanitizes them.
    return request.remote_addr or "unknown"


def parse_user_agent(user_agent):
    value = user_agent or "Unknown"
    browser = "Other"
    for name, marker in (("Edge", "Edg/"), ("Chrome", "Chrome/"), ("Firefox", "Firefox/"), ("Safari", "Safari/")):
        if marker in value:
            browser = name
            break
    operating_system = "Other"
    for name, marker in (("Windows", "Windows"), ("macOS", "Macintosh"), ("Android", "Android"), ("iOS", "iPhone"), ("Linux", "Linux")):
        if marker in value:
            operating_system = name
            break
    device = "Mobile" if any(marker in value for marker in ("Mobile", "Android", "iPhone")) else "Desktop"
    return browser, operating_system, device


def ip_intelligence(ip):
    if ip in {"unknown", "127.0.0.1", "::1"} or not IP_API_URL:
        return {}
    try:
        response = requests.get(IP_API_URL.format(ip=ip), timeout=4)
        response.raise_for_status()
        payload = response.json()
        return {key: payload.get(key) for key in ("country_name", "region", "city", "latitude", "longitude", "org", "asn", "isp") if payload.get(key) is not None}
    except (requests.RequestException, ValueError) as exc:
        logger.warning("IP intelligence unavailable: %s", exc)
        return {}


def domain_records(domain):
    import dns.resolver
    result = {"A": [], "AAAA": [], "MX": [], "TXT": [], "NS": []}
    for record_type in result:
        try:
            answers = dns.resolver.resolve(domain, record_type, lifetime=4)
            result[record_type] = [answer.to_text().strip('"') for answer in answers]
        except Exception:
            result[record_type] = []
    return result


def rdap_metadata(domain):
    try:
        response = requests.get(f"https://rdap.org/domain/{domain}", timeout=5)
        response.raise_for_status()
        payload = response.json()
        events = {event.get("eventAction"): event.get("eventDate") for event in payload.get("events", [])}
        registrar = next((entity.get("vcardArray", [[], []])[1][1] for entity in payload.get("entities", []) if entity.get("roles") and "registrar" in entity["roles"]), None)
        nameservers = [server.get("ldhName") for server in payload.get("nameservers", [])]
        return {"registrar": registrar, "creation_date": events.get("registration"), "expiration_date": events.get("expiration"), "nameservers": nameservers}
    except (requests.RequestException, ValueError, IndexError, KeyError, TypeError) as exc:
        logger.info("RDAP metadata unavailable for %s: %s", domain, exc)
        return {"registrar": None, "creation_date": None, "expiration_date": None, "nameservers": []}


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self), camera=(self)"
    response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:"
    return response


@app.before_request
def basic_rate_limit():
    if request.endpoint == "article":
        key = client_ip()
        current = time.monotonic()
        timestamps = [stamp for stamp in request_counts.get(key, []) if current - stamp < RATE_WINDOW]
        if len(timestamps) >= RATE_LIMIT:
            return jsonify({"error": "Rate limit exceeded. Try again shortly."}), 429
        timestamps.append(current)
        request_counts[key] = timestamps


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        if request.form.get("csrf_token") != session.get("csrf"):
            abort(400, "Invalid CSRF token")
        candidate = request.form.get("password", "")
        valid = bool(ADMIN_PASSWORD_HASH and check_password_hash(ADMIN_PASSWORD_HASH, candidate))
        valid = valid or bool(ADMIN_PASSWORD and secrets.compare_digest(ADMIN_PASSWORD, candidate))
        if valid:
            session["admin_authenticated"] = True
            return redirect(request.args.get("next") or url_for("dashboard"))
        error = "Authentication failed."
    return render_template("login.html", error=error)


@app.post("/logout")
@csrf_protected
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
def home():
    return redirect(url_for("dashboard")) if session.get("admin_authenticated") else redirect(url_for("login"))


@app.get("/dashboard")
@admin_required
def dashboard():
    return render_template("dashboard.html")


@app.post("/api/links")
@admin_required
@csrf_protected
def create_link():
    link_id = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10]
    db = get_db()
    db.execute("INSERT INTO links (id, created_at) VALUES (?, ?)", (link_id, now_iso()))
    db.commit()
    return jsonify({"id": link_id, "url": url_for("article", link_id=link_id, _external=True)})


@app.get("/api/links")
@admin_required
def list_links():
    query = request.args.get("q", "").strip()[:80]
    db = get_db()
    rows = db.execute("SELECT l.*, COUNT(v.id) AS visits FROM links l LEFT JOIN visits v ON v.link_id = l.id WHERE l.id LIKE ? GROUP BY l.id ORDER BY l.created_at DESC", (f"%{query}%",)).fetchall()
    return jsonify([dict(row) for row in rows])


@app.get("/api/links/<link_id>/visits")
@admin_required
def list_visits(link_id):
    rows = get_db().execute("SELECT * FROM visits WHERE link_id = ? ORDER BY visited_at DESC", (link_id,)).fetchall()
    return jsonify([dict(row) for row in rows])


@app.get("/article/<link_id>")
def article(link_id):
    link = get_db().execute("SELECT id FROM links WHERE id = ?", (link_id,)).fetchone()
    if link is None:
        abort(404)
    user_agent = request.headers.get("User-Agent", "")[:500]
    browser, operating_system, device = parse_user_agent(user_agent)
    intel = ip_intelligence(client_ip())
    get_db().execute("INSERT INTO visits (link_id, visited_at, ip_address, user_agent, browser, operating_system, device_type, ip_intelligence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (link_id, now_iso(), client_ip(), user_agent, browser, operating_system, device, json.dumps(intel)))
    get_db().commit()
    return render_template("article.html", link_id=link_id)


@app.post("/api/visits/<link_id>/consent")
def record_consent(link_id):
    data = request.get_json(silent=True) or {}
    consent_type = data.get("type")
    if consent_type not in {"gps", "camera"} or data.get("status") not in {"granted", "denied"}:
        return jsonify({"error": "Invalid consent event"}), 400
    visit = get_db().execute("SELECT id FROM visits WHERE link_id = ? ORDER BY visited_at DESC LIMIT 1", (link_id,)).fetchone()
    if visit is None:
        return jsonify({"error": "Visit not found"}), 404
    payload = json.dumps({"type": consent_type, "status": data["status"], "latitude": data.get("latitude"), "longitude": data.get("longitude")})
    get_db().execute("INSERT INTO consent_events (visit_id, event_at, event_type, payload) VALUES (?, ?, ?, ?)", (visit["id"], now_iso(), consent_type, payload))
    get_db().commit()
    return jsonify({"ok": True})


@app.post("/api/visits/<link_id>/telemetry")
def record_telemetry(link_id):
    data = request.get_json(silent=True) or {}
    allowed = {"screen_resolution", "language", "timezone", "referrer", "capabilities"}
    clean = {key: str(data[key])[:300] for key in allowed if data.get(key) is not None}
    visit = get_db().execute("SELECT id FROM visits WHERE link_id = ? ORDER BY visited_at DESC LIMIT 1", (link_id,)).fetchone()
    if visit is None:
        return jsonify({"error": "Visit not found"}), 404
    get_db().execute("UPDATE visits SET screen_resolution = ?, language = ?, timezone = ?, referrer = ?, capabilities = ? WHERE id = ?", (clean.get("screen_resolution"), clean.get("language"), clean.get("timezone"), clean.get("referrer"), clean.get("capabilities"), visit["id"]))
    get_db().commit()
    return jsonify({"ok": True})


@app.post("/api/domain-analysis")
@admin_required
@csrf_protected
def analyze_domain():
    data = request.get_json(silent=True) or request.form
    domain = (data.get("domain") or "").strip().lower().rstrip(".")
    if not domain or len(domain) > 253 or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789.-" for char in domain) or "." not in domain:
        return jsonify({"error": "Enter a valid public domain name."}), 400
    try:
        records = domain_records(domain)
        metadata = rdap_metadata(domain)
        return jsonify({"domain": domain, "records": records, "metadata": metadata, "note": "DNS and RDAP results are public records. Location estimates are approximate; no private information is queried."})
    except ImportError:
        return jsonify({"error": "Install dnspython before using domain analysis."}), 503


@app.cli.command("init-db")
def init_db_command():
    init_db()
    print("Database initialized.")


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=os.environ.get("FLASK_DEBUG") == "1")
