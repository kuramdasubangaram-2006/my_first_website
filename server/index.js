import express from 'express';
import http from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createSession, getSession, grantConsent, declineConsent, listSessions, deleteSession, hashToken, formatSession } from './db.js';

dotenv.config();
const app = express(); const server = http.createServer(app); const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' } });
app.set('trust proxy', 1);
if (process.env.NODE_ENV === 'production') app.use((req, res, next) => req.secure ? next() : res.redirect(`https://${req.headers.host}${req.originalUrl}`));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' })); app.use(express.json({ limit: '32kb' })); app.use(morgan('tiny'));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));
const admin = (req, res, next) => { try { jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET || 'development-only-secret'); next(); } catch { res.status(401).json({ error: 'Admin authentication required' }); } };
const browserInfo = (ua = '') => { const browser = ua.match(/(Edg|Chrome|Firefox|Safari|Version)\/?([\d.]+)/i); const os = ua.match(/(Windows NT|Mac OS X|Android|iPhone OS|Linux)[ /]?([\d._-]*)/i); return { browser: browser ? `${browser[1]} ${browser[2]}` : 'Unknown browser', operating_system: os ? os[1].replace(' NT', '') : 'Unknown OS', device_type: /Mobile|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop' }; };
const isPrivateOrLoopback = (ip) => !ip || ip === 'localhost' || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') || ip.startsWith('172.2') || ip.startsWith('172.30.') || ip.startsWith('172.31.') || ip.startsWith('fc') || ip.startsWith('fd');
const resolveLocationIp = async (ip) => {
	if (!isPrivateOrLoopback(ip) && isIP(ip)) return ip;
	const response = await fetch('https://api.ipify.org?format=json');
	if (!response.ok) return ip;
	const data = await response.json();
	return data.ip || ip;
};
const normalizeIpLocation = (data, ip) => ({
	ip: data.ip || ip,
	city: data.city_name || data.city?.name || data.city || null,
	region: data.region_name || data.region?.name || data.region || null,
	country: data.country_name || data.country?.name || data.country || data.country_code || null,
	metadata: {
		countryCode: data.country_code || null,
		district: data.district || null,
		zipCode: data.zip_code || null,
		latitude: data.latitude ?? null,
		longitude: data.longitude ?? null,
		timeZone: data.time_zone || data.time_zone_info?.olson || null,
		asn: data.asn || data.as_info?.as_number || data.connection?.asn || null,
		isp: data.isp || data.connection?.isp || data.connection?.org || null,
		domain: data.domain || data.connection?.domain || null,
		netSpeed: data.net_speed || data.connection?.type || null,
		usageType: data.usage_type || data.as_info?.as_usage_type || null,
		isProxy: data.is_proxy ?? data.proxy?.is_residential_proxy ?? data.security?.proxy ?? null,
		isVpn: data.proxy?.is_vpn ?? data.security?.vpn ?? null,
		fraudScore: data.fraud_score ?? data.security?.fraud_score ?? null
	}
});
const lookupIpLocation = async (ip) => {
	if (process.env.IP2LOCATION_API_KEY) {
		try {
			const url = new URL(process.env.IP2LOCATION_API_URL || 'https://api.ip2location.io/');
			url.searchParams.set('key', process.env.IP2LOCATION_API_KEY);
			url.searchParams.set('ip', ip);
			url.searchParams.set('format', 'json');
			const response = await fetch(url);
			if (response.ok) {
				const data = await response.json();
				return normalizeIpLocation(data, ip);
			}
		} catch {}
	}
	const response = await fetch(`${process.env.IP_GEOLOCATION_URL || 'https://ipapi.co'}/${ip}/json/`);
	if (response.ok) {
		const data = await response.json();
		if (data.city || data.region || data.country_name || data.country) return normalizeIpLocation(data, ip);
	}
	const fallback = await fetch(`https://ipwho.is/${ip}`);
	if (!fallback.ok) return {};
	const data = await fallback.json();
	return data.success === false ? {} : normalizeIpLocation(data, ip);
};
app.post('/api/auth/login', (req, res) => { const { email, password } = req.body || {}; if (email !== (process.env.ADMIN_EMAIL || 'admin@example.com') || password !== (process.env.ADMIN_PASSWORD || 'change-me-immediately')) return res.status(401).json({ error: 'Invalid credentials' }); res.json({ token: jwt.sign({ sub: email, role: 'admin' }, process.env.JWT_SECRET || 'development-only-secret', { expiresIn: '8h' }) }); });
app.post('/api/tracking-links', async (_req, res) => { const token = crypto.randomBytes(24).toString('base64url'); await createSession(hashToken(token)); res.status(201).json({ token, path: `/track/${token}` }); });
app.get('/api/tracking/:token', async (req, res) => { const session = await getSession(hashToken(req.params.token)); if (!session) return res.status(404).json({ error: 'Tracking link not found' }); res.json({ id: session.id, status: session.consent_status }); });
app.post('/api/tracking/:token/consent', async (req, res) => { const tokenHash = hashToken(req.params.token); const session = await getSession(tokenHash); if (!session) return res.status(404).json({ error: 'Tracking link not found' }); const payload = req.body || {}; const ua = req.get('user-agent'); const clientIp = req.ip.replace('::ffff:', ''); const lookupIp = await resolveLocationIp(clientIp).catch(() => clientIp); const geo = await lookupIpLocation(lookupIp).catch(() => ({})); const data = { ...browserInfo(ua), ip_address: geo.ip || lookupIp, ip_city: geo.city || geo.city_name || null, ip_region: geo.region || geo.region_name || null, ip_country: geo.country_name || geo.country || geo.country_code || null, ip_metadata: geo.metadata || null, latitude: payload.latitude || geo.metadata?.latitude || null, longitude: payload.longitude || geo.metadata?.longitude || null, screen_resolution: payload.screenResolution || null, time_zone: payload.timeZone || geo.metadata?.timeZone || null, language: payload.language || null, referrer: payload.referrer || null }; const updated = await grantConsent(tokenHash, data); const output = formatSession(updated); io.emit('session:updated', output); res.json(output); });
app.post('/api/tracking/:token/decline', async (req, res) => { const updated = await declineConsent(hashToken(req.params.token)); if (!updated) return res.status(404).json({ error: 'Tracking link not found' }); res.json({ status: 'declined' }); });
app.get('/api/sessions', async (req, res) => res.json(await listSessions({ search: String(req.query.search || '') })));
app.delete('/api/sessions/:id', async (req, res) => { await deleteSession(req.params.id); res.status(204).end(); });
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.resolve('client'))); app.get('*', (_req, res) => res.sendFile(path.resolve('client/index.html')));
server.listen(Number(process.env.PORT || 3001), () => console.log(`Consent Signal server listening on ${process.env.PORT || 3001}`));
