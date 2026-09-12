import pg from 'pg';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
dotenv.config();

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }) : null;
const memory = new Map();
const auditMemory = [];
const users = new Map();
const key = process.env.FIELD_ENCRYPTION_KEY ? Buffer.from(process.env.FIELD_ENCRYPTION_KEY, 'base64') : null;
const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD;
const schemaReady = pool ? initializeDatabase() : initializeMemory();

async function initializeDatabase() {
  if (!adminPassword) throw new Error('ADMIN_PASSWORD must be configured');
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query('ALTER TABLE tracking_sessions ADD COLUMN IF NOT EXISTS owner_id UUID');
  await pool.query('ALTER TABLE tracking_sessions ADD COLUMN IF NOT EXISTS ip_metadata_enc TEXT');
  await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, \'admin\') ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=\'admin\'', [adminEmail, await bcrypt.hash(adminPassword, 12)]);
  await pool.query('UPDATE tracking_sessions SET owner_id = (SELECT id FROM users WHERE email = $1) WHERE owner_id IS NULL', [adminEmail]);
  await pool.query('ALTER TABLE tracking_sessions ALTER COLUMN owner_id SET NOT NULL');
  await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_sessions_owner_id_fkey') THEN ALTER TABLE tracking_sessions ADD CONSTRAINT tracking_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE; END IF; END $$`);
  await pool.query('CREATE INDEX IF NOT EXISTS tracking_sessions_owner_id_idx ON tracking_sessions (owner_id)');
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, action TEXT NOT NULL, session_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

async function initializeMemory() {
  if (!adminPassword) throw new Error('ADMIN_PASSWORD must be configured');
  users.set(adminEmail, { id: crypto.randomUUID(), email: adminEmail, password_hash: await bcrypt.hash(adminPassword, 12), role: 'admin' });
}

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

export async function createUser(email, password, role = 'user') {
  const normalizedEmail = String(email).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  if (!pool) {
    if (users.has(normalizedEmail)) return null;
    const user = { id: crypto.randomUUID(), email: normalizedEmail, password_hash: passwordHash, role };
    users.set(normalizedEmail, user);
    return user;
  }
  await schemaReady;
  try {
    const { rows } = await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role', [normalizedEmail, passwordHash, role]);
    return rows[0];
  } catch (error) {
    if (error.code === '23505') return null;
    throw error;
  }
}

export async function authenticateUser(email, password) {
  await schemaReady;
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = pool ? (await pool.query('SELECT id, email, password_hash, role FROM users WHERE email=$1', [normalizedEmail])).rows[0] : users.get(normalizedEmail);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return null;
  return { id: user.id, email: user.email, role: user.role };
}

export async function createSession(tokenHash, ownerId) {
  const session = { id: crypto.randomUUID(), token_hash: tokenHash, owner_id: ownerId, created_at: new Date().toISOString(), consent_status: 'pending' };
  if (!pool) { memory.set(tokenHash, session); return session; }
  await schemaReady;
  const { rows } = await pool.query('INSERT INTO tracking_sessions (token_hash, owner_id) VALUES ($1, $2) RETURNING *', [tokenHash, ownerId]); return rows[0];
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
export async function addAuditLog(action, sessionId) {
  if (!pool) {
    auditMemory.push({
      id: auditMemory.length + 1,
      action,
      session_id: sessionId,
      created_at: new Date().toISOString()
    });
    return;
  }

  await schemaReady;
  await pool.query(
    'INSERT INTO audit_logs (action, session_id) VALUES ($1, $2)',
    [action, sessionId]
  );
}
export async function listAuditLogs() {
  if (!pool) return [...auditMemory].reverse();

  await schemaReady;

  const result = await pool.query(
    `SELECT id, action, session_id, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT 100`
  );

  return result.rows;
}
export async function declineConsent(tokenHash) {
  if (!pool) { const session = memory.get(tokenHash); if (session) session.consent_status = 'declined'; return session; }
  const { rows } = await pool.query("UPDATE tracking_sessions SET consent_status='declined' WHERE token_hash=$1 RETURNING *", [tokenHash]); return rows[0];
}
export async function listSessions({ search = '', userId, isAdmin = false } = {}) {
  let rows;
  if (!pool) rows = [...memory.values()].filter((session) => isAdmin || session.owner_id === userId);
  else {
    await schemaReady;
    const query = isAdmin ? 'SELECT * FROM tracking_sessions ORDER BY created_at DESC LIMIT 200' : 'SELECT * FROM tracking_sessions WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 200';
    ({ rows } = await pool.query(query, isAdmin ? [] : [userId]));
  }
  return rows.map(formatSession).filter((session) => !search || JSON.stringify(session).toLowerCase().includes(search.toLowerCase()));
}
export async function deleteSession(id, userId, isAdmin = false) {
  if (!pool) { for (const [token, session] of memory) if (session.id === id && (isAdmin || session.owner_id === userId)) memory.delete(token); return; }
  await schemaReady;
  await pool.query(isAdmin ? 'DELETE FROM tracking_sessions WHERE id=$1' : 'DELETE FROM tracking_sessions WHERE id=$1 AND owner_id=$2', isAdmin ? [id] : [id, userId]);
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
