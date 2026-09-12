import React from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { ShieldCheck, MapPin, MonitorSmartphone, Globe2, Clock3, Trash2, Plus, Search, LockKeyhole, Radio, LogOut, ExternalLink, ChevronRight } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './timeline.css';
import './details.css';

const api = async (path, options = {}) => { const token = localStorage.getItem('adminToken'); const response = await fetch(`https://my-first-website-1-58br.onrender.com/api${path}`,  { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } }); if (!response.ok) throw new Error((await response.json()).error || 'Request failed'); return response.status === 204 ? null : response.json(); };
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Waiting';
const collectDeviceTelemetry = async () => { let battery = null; try { if (navigator.getBattery) { const info = await navigator.getBattery(); battery = { level: Math.round(info.level * 100), charging: info.charging }; } } catch {} const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection; return { battery, network: connection ? { effectiveType: connection.effectiveType || null, downlinkMbps: connection.downlink ?? null, rttMs: connection.rtt ?? null, saveData: connection.saveData ?? null, type: connection.type || null } : null }; };
function App() { const track = location.pathname.match(/^\/track\/([^/]+)$/); return track ? <MinimalConsentPage token={track[1]} /> : <Dashboard />; }
function MinimalConsentPage({ token }) {
  const [pending, setPending] = React.useState(false);
  const [thanked, setThanked] = React.useState(false);

  const allow = async () => {
    setPending(true);

    let coords = {};

    if (navigator.geolocation) {
      coords = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude
            });
          },
          (error) => {
  alert(`GPS Error: ${error.code} - ${error.message}`);
  resolve({});
},
          {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0
          }
        );
      });
    }

    try {
      await api(`/tracking/${token}/consent`, {
        method: 'POST',
        body: JSON.stringify({
          ...coords,
          screenResolution: `${screen.width} x ${screen.height}`,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
          referrer: document.referrer || null
        })
      });

      setThanked(true);
    } finally {
      setPending(false);
    }
  };

  const decline = async () => {
    setPending(true);

    try {
      await api(`/tracking/${token}/decline`, {
        method: 'POST'
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="consent-shell">
      {thanked ? (
        <div className="thank-you">Thank You</div>
      ) : (
        <div className="consent-actions">
          <button
            className="primary"
            disabled={pending}
            onClick={allow}
          >
            {pending ? 'Collecting...' : 'Allow'}
          </button>

          <button
            className="secondary"
            disabled={pending}
            onClick={decline}
          >
            Not Allow
          </button>
        </div>
      )}
    </main>
  );
}
function ConsentPage({ token }) { const [status, setStatus] = React.useState('loading'); const [error, setError] = React.useState(''); React.useEffect(() => { api(`/tracking/${token}`).then((data) => setStatus(data.status)).catch(() => setError('This tracking link is invalid or has expired.')); }, [token]); const allow = async () => { setStatus('collecting'); let coords = {}; if (navigator.geolocation) coords = await new Promise((resolve) => navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => resolve({}), { timeout: 8000 })); try { await api(`/tracking/${token}/consent`, { method: 'POST', body: JSON.stringify({ ...coords, screenResolution: `${screen.width} x ${screen.height}`, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, language: navigator.language, referrer: document.referrer || null }) }); setStatus('complete'); } catch { setError('We could not complete this consent session.'); setStatus('ready'); } }; const decline = async () => { await api(`/tracking/${token}/decline`, { method: 'POST' }); setStatus('declined'); }; if (error) return <main className="consent-shell"><div className="consent-card"><ShieldCheck size={30}/><h1>Link unavailable</h1><p>{error}</p></div></main>; if (status === 'complete' || status === 'declined') return <main className="consent-shell"><div className="consent-card centered"><div className="success-mark">{status === 'complete' ? '✓' : '—'}</div><h1>{status === 'complete' ? 'Thank you for your choice' : 'No information collected'}</h1><p>{status === 'complete' ? 'Your consented session has been recorded. You can close this page.' : 'Your decision was recorded and the session will remain empty.'}</p></div></main>; return <main className="consent-shell"><div className="consent-card"><div className="eyebrow"><ShieldCheck size={16}/> CONSENT SIGNAL</div><h1>Choose what to share.</h1><p className="lead">This page asks for permission before collecting limited information about your visit. You are in control, and declining will not affect anything else.</p><div className="collection-list"><Info icon={<Globe2/>} title="Public IP address" copy="Used to estimate a general city, region, and country."/><Info icon={<MapPin/>} title="Approximate location" copy="Derived from your IP address and never treated as precise GPS."/><Info icon={<MapPin/>} title="Optional GPS location" copy="Requested only after you allow this page to continue, through your browser's permission prompt."/><Info icon={<MonitorSmartphone/>} title="Browser and device details" copy="Browser, operating system, device type, display size, language, time zone, and referrer."/></div><div className="notice"><LockKeyhole size={18}/><span>We do not collect passwords, cookies, tokens, contacts, files, camera, microphone, or any other private content.</span></div><div className="consent-actions"><button className="primary" disabled={status === 'collecting'} onClick={allow}>{status === 'collecting' ? 'Collecting consented data...' : 'Allow & Continue'} <ChevronRight size={18}/></button><button className="secondary" onClick={decline}>Decline</button></div><small>By continuing, you agree to the collection described above. Data is retained for 90 days and can be deleted by the administrator.</small></div></main> }
function Info({ icon, title, copy }) { return <div className="info-row"><div className="icon-box">{icon}</div><div><strong>{title}</strong><p>{copy}</p></div></div> }
function Dashboard() {
	const [authed, setAuthed] = React.useState(() => !!localStorage.getItem('adminToken'));
	return authed ? <Admin setAuthed={() => setAuthed(false)} /> : <Login onLogin={() => setAuthed(true)} />;
}
function Login({ onLogin }) {
	const [registering, setRegistering] = React.useState(false);
	const [form, setForm] = React.useState({ email: '', password: '' });
	const [error, setError] = React.useState('');
	const submit = async (e) => {
		e.preventDefault();
		try {
			const data = await api(registering ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(form) });
			localStorage.setItem('adminToken', data.token);
			onLogin();
		} catch (e) { setError(e.message); }
	};
	return <main className="login-shell"><div className="login-visual"><div className="brand-mark"><Radio size={22}/></div><p className="eyebrow">PRIVACY OPERATIONS</p><h1>Consent, made visible.</h1><p>One calm surface for every consented signal, with the privacy boundary always in view.</p></div><form className="login-card" onSubmit={submit}><div className="eyebrow"><LockKeyhole size={16}/> PRIVATE DASHBOARD</div><h2>{registering ? 'Create account' : 'Sign in'}</h2><label>Email<input type="email" required value={form.email} onChange={(e) => setForm({...form, email: e.target.value})}/></label><label>Password<input type="password" required minLength={10} value={form.password} onChange={(e) => setForm({...form, password: e.target.value})}/></label>{error && <p className="error">{error}</p>}<button className="primary">{registering ? 'Create account' : 'Enter dashboard'} <ChevronRight size={18}/></button><button type="button" className="secondary" onClick={() => { setRegistering(!registering); setError(''); }}>{registering ? 'Back to sign in' : 'Create a user account'}</button><small>Each account can access only the tracking links and sessions it owns.</small></form></main>;
}
function Admin({ setAuthed }) {
  const [sessions, setSessions] = React.useState([]);
  const [auditLogs, setAuditLogs] = React.useState([]);
  const [search, setSearch] = React.useState('');
  const [link, setLink] = React.useState('');

  const load = React.useCallback(
    () =>
      api(`/sessions?search=${encodeURIComponent(search)}`)
        .then(setSessions)
        .catch(() => {
          localStorage.removeItem('adminToken');
          setAuthed(false);
        }),
    [search, setAuthed]
  );

  const loadAuditLogs = React.useCallback(
    () => api('/audit-logs').then(setAuditLogs).catch(() => {}),
    []
  );

  React.useEffect(() => {
    load();
    loadAuditLogs();

    const socket = io('https://my-first-website-1-58br.onrender.com');

    socket.on('session:updated', () => {
      load();
      loadAuditLogs();
    });

    return () => socket.disconnect();
  }, [load, loadAuditLogs]);

  const createLink = async () => {
    const data = await api('/tracking-links', { method: 'POST' });
    setLink(`${location.origin}${data.path}`);
  };

  const remove = async (id) => {
    await api(`/sessions/${id}`, { method: 'DELETE' });
    load();
  };

  const consented = sessions.filter(
    (s) => s.consentStatus === 'granted'
  );

  const gps = consented.filter((s) => s.gps).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Radio size={18} />
          </div>
          <span>
            CONSENT <b>SIGNAL</b>
          </span>
        </div>

        <div className="top-actions">
          <span className="live">
            <i /> LIVE FEED
          </span>

          <button
            className="icon-button"
            title="Sign out"
            onClick={() => {
              localStorage.removeItem('adminToken');
              setAuthed(false);
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="dashboard">
        <div className="page-heading">
          <div>
            <p className="eyebrow">OVERVIEW / PRIVACY OPERATIONS</p>
            <h1>Signal overview</h1>
            <p className="muted">
              Every record below was created after an explicit consent
              decision.
            </p>
          </div>

          <button className="primary" onClick={createLink}>
            <Plus size={18} /> Create tracking link
          </button>
        </div>

        {link && (
          <div className="link-banner">
            <span>New consent link</span>
            <code>{link}</code>

            <button onClick={() => navigator.clipboard.writeText(link)}>
              Copy
            </button>
          </div>
        )}

        <div className="stats">
          <Stat
            icon={<Radio />}
            label="Total sessions"
            value={sessions.length}
            accent="lime"
          />

          <Stat
            icon={<ShieldCheck />}
            label="Consent granted"
            value={consented.length}
            accent="blue"
          />

          <Stat
            icon={<MapPin />}
            label="GPS permitted"
            value={gps}
            accent="orange"
          />

          <Stat
            icon={<Clock3 />}
            label="Retention window"
            value="90d"
            accent="violet"
          />
        </div>

        <div className="content-grid">
          <section className="panel sessions-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">SESSION STREAM</p>
                <h2>Recent sessions</h2>
              </div>

              <div className="search">
                <Search size={16} />

                <input
                  placeholder="Search sessions"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Captured</th>
                    <th>IP / location</th>
                    <th>Device</th>
                    <th>Consent</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>#{s.id.slice(0, 8)}</strong>
                        <small>{s.language || 'Pending'}</small>
                      </td>

                      <td>
                        {formatDate(s.capturedAt || s.createdAt)}
                      </td>

                      <td>
                        <strong>{s.ip || 'Not captured'}</strong>

                        <small>
                          {[s.location?.city, s.location?.country]
                            .filter(Boolean)
                            .join(', ') || 'Awaiting consent'}
                        </small>
                      </td>

                      <td>
                        <strong>{s.deviceType || '—'}</strong>
                        <small>{s.browser || '—'}</small>
                      </td>

                      <td>
                        <span
                          className={`status ${s.consentStatus}`}
                        >
                          {s.consentStatus}
                        </span>
                      </td>

                      <td>
                        <button
                          className="delete-button"
                          title="Delete session"
                          onClick={() => remove(s.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!sessions.length && (
                <div className="empty">
                  No sessions yet. Create a link and send it to a user.
                </div>
              )}
            </div>
          </section>

          <aside className="side-stack">
            <MapPanel sessions={consented} />

            <div className="panel privacy-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">DATA GUARDRAIL</p>
                  <h2>Privacy posture</h2>
                </div>

                <ShieldCheck className="green" />
              </div>

              <div className="guardrail">
                <span className="dot green-dot" />
                <span>Explicit consent required</span>
                <b>ENFORCED</b>
              </div>

              <div className="guardrail">
                <span className="dot blue-dot" />
                <span>GPS permission</span>
                <b>OPTIONAL</b>
              </div>

              <div className="guardrail">
                <span className="dot orange-dot" />
                <span>Auto deletion</span>
                <b>90 DAYS</b>
              </div>
            </div>
          </aside>
        </div>

        <section className="panel audit-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SECURITY ACTIVITY</p>
              <h2>Audit Logs</h2>
            </div>
          </div>

          <div className="audit-list">
            {auditLogs.map((log) => (
              <div className="audit-row" key={log.id}>
                <div>
                  <strong>{log.action}</strong>
                  <small>
                    Session: {log.session_id || '—'}
                  </small>
                </div>

                <span>{formatDate(log.created_at)}</span>
              </div>
            ))}

            {!auditLogs.length && (
              <div className="timeline-empty">
                No audit events yet.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
function Stat({ icon, label, value, accent }) { return <div className={`stat ${accent}`}><div className="stat-icon">{icon}</div><div><p>{label}</p><strong>{value}</strong></div></div> }
function MapPanel({ sessions }) { const [Map, setMap] = React.useState(null); React.useEffect(() => { import('react-leaflet').then(setMap); }, []); const point = sessions.find((s) => s.gps)?.gps; return <div className="panel map-panel"><div className="panel-heading"><div><p className="eyebrow">LOCATION LAYER</p><h2>Consent map</h2></div><MapPin size={18}/></div>{Map && point ? <Map.MapContainer center={[point.latitude, point.longitude]} zoom={4} scrollWheelZoom={false} className="map"><Map.TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Map.Marker position={[point.latitude, point.longitude]}><Map.Popup>GPS-permitted session</Map.Popup></Map.Marker></Map.MapContainer> : <div className="map-placeholder"><MapPin size={24}/><span>{sessions.length ? 'Approximate IP locations are shown in the table. GPS appears here only when permitted.' : 'Consent locations will appear here.'}</span></div>}<div className="map-legend"><span><i className="legend-dot blue-dot"/> IP approximate</span><span><i className="legend-dot orange-dot"/> GPS permitted</span></div><div className="timeline"><p className="eyebrow">SESSION TIMELINE</p>{sessions.slice(0, 3).map((session) => <div className="timeline-row" key={session.id}><i className="timeline-dot"/><div><strong>{session.location?.city || 'Location unavailable'} signal received</strong><small>{formatDate(session.capturedAt)} · {session.deviceType || 'Device unknown'}</small></div></div>)}{!sessions.length && <div className="timeline-empty">Consent events will appear here in real time.</div>}</div><div className="ip-intelligence"><p className="eyebrow">IP INTELLIGENCE</p>{sessions.filter((session) => session.ipMetadata).slice(0, 3).map((session) => <div className="ip-intelligence-row" key={session.id}><strong>{session.ip || 'IP unavailable'}</strong><span>{session.locationLabel || 'Location unavailable'}</span><small>ISP: {session.ipMetadata?.isp || '—'} · ASN: {session.ipMetadata?.asn || '—'} · District: {session.ipMetadata?.district || '—'} · ZIP: {session.ipMetadata?.zipCode || '—'}</small><small>Timezone: {session.ipMetadata?.timeZone || session.timeZone || '—'} · Network: {session.ipMetadata?.netSpeed || '—'} · Usage: {session.ipMetadata?.usageType || '—'}</small><small>Proxy: {session.ipMetadata?.isProxy == null ? '—' : session.ipMetadata.isProxy ? 'Yes' : 'No'} · VPN: {session.ipMetadata?.isVpn == null ? '—' : session.ipMetadata.isVpn ? 'Yes' : 'No'} · Fraud score: {session.ipMetadata?.fraudScore == null ? '—' : session.ipMetadata.fraudScore}</small></div>)}{!sessions.some((session) => session.ipMetadata) && <div className="timeline-empty">Detailed IP intelligence appears after consent.</div>}</div></div> }

const browserFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
	const url = typeof input === 'string' ? input : input.url;
	if (url?.includes('/api/tracking/') && url.endsWith('/consent') && init.body) {
		try {
			const body = JSON.parse(init.body);
			const telemetry = await collectDeviceTelemetry();
			body.battery = body.battery || telemetry.battery;
			body.network = body.network || telemetry.network;
			body.referrer = `__telemetry__:${JSON.stringify({ referrer: body.referrer || null, battery: body.battery, network: body.network })}`;
			init.body = JSON.stringify(body);
		} catch {}
	}
	return browserFetch(input, init);
};
createRoot(document.getElementById('root')).render(<App/>);
