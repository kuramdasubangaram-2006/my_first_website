import pg from 'pg';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }) : null;
const memory = new Map();
const key = process.env.FIELD_ENCRYPTION_KEY ? Buffer.from(process.env.FIELD_ENCRYPTION_KEY, 'base64') : null;
const schemaReady = pool ? pool.query('ALTER TABLE tracking_sessions ADD COLUMN IF NOT EXISTS ip_metadata_enc TEXT').catch(() => {}) : Promise.resolve();

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const encrypt = (value) => {
  if (!value || !key || key.length !== 32) return value || null;
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
};
export const decrypt = (value) => {
  if (!value || !key || key.length !== 32 || !value.includes('.')) return value || null;
  const [iv, tag, encrypted] = value.split('.'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
};

export async function createSession(tokenHash) {
  const session = { id: crypto.randomUUID(), token_hash: tokenHash, created_at: new Date().toISOString(), consent_status: 'pending' };
  if (!pool) { memory.set(tokenHash, session); return session; }
  const { rows } = await pool.query('INSERT INTO tracking_sessions (token_hash) VALUES ($1) RETURNING *', [tokenHash]); return rows[0];
}
export async function getSession(tokenHash) {
  if (!pool) return memory.get(tokenHash) || null;
  const { rows } = await pool.query('SELECT * FROM tracking_sessions WHERE token_hash = $1', [tokenHash]); return rows[0] || null;
}
export async function grantConsent(tokenHash, data) {
  const timestamp = new Date().toISOString();
  if (typeof data.referrer === 'string' && data.referrer.startsWith('__telemetry__:')) {
    try { const telemetry = JSON.parse(data.referrer.slice('__telemetry__:'.length)); data.ip_metadata = { ...(data.ip_metadata || {}), battery: telemetry.battery || null, network: telemetry.network || null }; data.referrer = telemetry.referrer || null; } catch {}
  }
  if (!pool) { const session = memory.get(tokenHash); Object.assign(session, data, { consent_status: 'granted', consent_at: timestamp, captured_at: timestamp }); return session; }
  await schemaReady;
  const values = [timestamp, timestamp, encrypt(data.ip_address), encrypt(data.ip_city), encrypt(data.ip_region), encrypt(data.ip_country), encrypt(data.ip_metadata ? JSON.stringify(data.ip_metadata) : null), encrypt(data.latitude), encrypt(data.longitude), data.browser, data.operating_system, data.device_type, data.screen_resolution, data.time_zone, data.language, data.referrer, tokenHash];
  const { rows } = await pool.query(`UPDATE tracking_sessions SET consent_status='granted', consent_at=$1, captured_at=$2, ip_address_enc=$3, ip_city_enc=$4, ip_region_enc=$5, ip_country_enc=$6, ip_metadata_enc=$7, latitude_enc=$8, longitude_enc=$9, browser=$10, operating_system=$11, device_type=$12, screen_resolution=$13, time_zone=$14, language=$15, referrer=$16 WHERE token_hash=$17 RETURNING *`, values); return rows[0];
}
export async function declineConsent(tokenHash) {
  if (!pool) { const session = memory.get(tokenHash); if (session) session.consent_status = 'declined'; return session; }
  const { rows } = await pool.query("UPDATE tracking_sessions SET consent_status='declined' WHERE token_hash=$1 RETURNING *", [tokenHash]); return rows[0];
}
export async function listSessions({ search = '' } = {}) {
  let rows;
  if (!pool) rows = [...memory.values()];
  else ({ rows } = await pool.query('SELECT * FROM tracking_sessions ORDER BY created_at DESC LIMIT 200'));
  return rows.map(formatSession).filter((session) => !search || JSON.stringify(session).toLowerCase().includes(search.toLowerCase()));
}
export async function deleteSession(id) {
  if (!pool) { for (const [token, session] of memory) if (session.id === id) memory.delete(token); return; }
  await pool.query('DELETE FROM tracking_sessions WHERE id=$1', [id]);
}
export function formatSession(row) {
  const ip = decrypt(row.ip_address_enc ?? row.ip_address);
  const location = { city: decrypt(row.ip_city_enc ?? row.ip_city), region: decrypt(row.ip_region_enc ?? row.ip_region), country: decrypt(row.ip_country_enc ?? row.ip_country) };
  const latitude = row.latitude_enc ?? row.latitude;
  const longitude = row.longitude_enc ?? row.longitude;
  let ipMetadata = row.ip_metadata_enc ?? row.ip_metadata ?? null;
  try { ipMetadata = typeof ipMetadata === 'string' ? JSON.parse(decrypt(ipMetadata)) : ipMetadata; } catch { ipMetadata = null; }
  if (ipMetadata) ipMetadata = { ...ipMetadata, netSpeed: ipMetadata.netSpeed || ipMetadata.network?.effectiveType || null, usageType: ipMetadata.usageType || (ipMetadata.battery?.level != null ? `Battery ${ipMetadata.battery.level}%${ipMetadata.battery.charging ? ' (charging)' : ''}` : null) };
    const detailLabel = ipMetadata ? [`1. Location: ${[location.city, location.region, location.country].filter(Boolean).join(', ') || '—'}`, `2. IP address: ${ip || '—'}`, `3. ISP: ${ipMetadata.isp || '—'}`, `4. ASN: ${ipMetadata.asn || '—'}`, `5. District: ${ipMetadata.district || '—'}`, `6. ZIP code: ${ipMetadata.zipCode || '—'}`, `7. Timezone: ${ipMetadata.timeZone || row.time_zone || '—'}`, `8. Network: ${ipMetadata.netSpeed || '—'}`, `9. Usage: ${ipMetadata.usageType || '—'}`, `10. Battery: ${ipMetadata.battery?.level == null ? '—' : `${ipMetadata.battery.level}%${ipMetadata.battery.charging ? ' charging' : ''}`}`, `11. Downlink: ${ipMetadata.network?.downlinkMbps == null ? '—' : `${ipMetadata.network.downlinkMbps} Mbps`}`, `12. RTT: ${ipMetadata.network?.rttMs == null ? '—' : `${ipMetadata.network.rttMs} ms`}`, `13. Proxy: ${ipMetadata.isProxy == null ? '—' : ipMetadata.isProxy ? 'Yes' : 'No'}`, `14. VPN: ${ipMetadata.isVpn == null ? '—' : ipMetadata.isVpn ? 'Yes' : 'No'}`, `15. Fraud score: ${ipMetadata.fraudScore == null ? '—' : ipMetadata.fraudScore}`, `16. Domain: ${ipMetadata.domain || '—'}`, `17. Coordinates: ${ipMetadata.latitude ?? latitude ?? '—'}, ${ipMetadata.longitude ?? longitude ?? '—'}`, `18. Screen size: ${row.screen_resolution || '—'}`, `19. Language: ${row.language || '—'}`, `20. Browser: ${row.browser || '—'}`, `21. Operating system: ${row.operating_system || '—'}`, `22. Device: ${row.device_type || '—'}`].join('\n') : null;
    const completeDetailLabel = detailLabel;
    return { id: row.id, createdAt: row.created_at, consentStatus: row.consent_status, consentAt: row.consent_at, capturedAt: row.captured_at, ip, location, locationLabel: completeDetailLabel || [location.city, location.region, location.country].filter(Boolean).join(', ') || null, detailLabel: completeDetailLabel, ipMetadata, gps: latitude != null && longitude != null ? { latitude: Number(decrypt(latitude)), longitude: Number(decrypt(longitude)) } : null, browser: row.browser, operatingSystem: row.operating_system, deviceType: row.device_type, screenResolution: row.screen_resolution, timeZone: row.time_zone, language: row.language, referrer: row.referrer };
}
