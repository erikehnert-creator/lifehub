/**
 * Kleiner Nachbau der Supabase-Schnittstellen (Auth + PostgREST) auf einer
 * echten Postgres-Datenbank. Zweck: die Synchronisation der App gegen das
 * tatsächliche Serverschema testen zu können, ohne ein Konto anzulegen.
 *
 * Nachgebildet wird genau der Ausschnitt, den LifeHub benutzt:
 *   POST /auth/v1/token?grant_type=password | refresh_token
 *   GET  /rest/v1/<tabelle>?server_rev=gt.N&order=server_rev.asc&limit=N
 *   POST /rest/v1/<tabelle>            (Upsert auf id, Rückgabe der Zeilen)
 *
 * Wichtig: Die Abfragen laufen als Rolle "authenticated" mit gesetztem
 * request.jwt.claim.sub – die Zeilensicherheit des echten Schemas greift also
 * genauso wie später bei Supabase.
 */
import http from 'node:http'
import pg from 'pg'

const PORT = Number(process.argv[2] || 54321)
const ANON = 'anon-test-key'
const USERS = new Map([
  ['erik@test.de', { password: 'geheim123', id: '11111111-1111-1111-1111-111111111111' }],
  ['fremd@test.de', { password: 'geheim123', id: '22222222-2222-2222-2222-222222222222' }],
])
const tokens = new Map()   // access_token -> { user, email, exp }
const refresh = new Map()  // refresh_token -> access_token-Ausstellung

const pool = new pg.Pool({
  host: '127.0.0.1', user: 'postgres', password: 'test', database: 'postgres', port: 5432,
})

function send(res, status, body, extra = {}) {
  const text = body === null ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'content-range',
    ...extra,
  })
  res.end(text)
}

function issue(email) {
  const user = USERS.get(email)
  const access = 'acc_' + Math.random().toString(36).slice(2) + Date.now()
  const refr = 'ref_' + Math.random().toString(36).slice(2)
  tokens.set(access, { user: user.id, email })
  refresh.set(refr, email)
  return { access_token: access, refresh_token: refr, expires_in: 3600, token_type: 'bearer', user: { id: user.id, email } }
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : null
}

/** Führt eine Abfrage als angemeldete Person aus – mit Zeilensicherheit. */
async function asUser(userId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE authenticated')
    await client.query(`SET LOCAL request.jwt.claim.sub = '${userId}'`)
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, null)
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/auth/v1/token') {
    if (req.headers.apikey !== ANON) return send(res, 401, { message: 'Ungültiger Projektschlüssel' })
    const body = await readBody(req)
    const grant = url.searchParams.get('grant_type')
    if (grant === 'refresh_token') {
      const email = refresh.get(body?.refresh_token)
      if (!email) return send(res, 400, { error_description: 'Refresh-Token unbekannt' })
      return send(res, 200, issue(email))
    }
    const u = USERS.get(String(body?.email || '').toLowerCase())
    if (!u || u.password !== body?.password) {
      return send(res, 400, { error_description: 'Invalid login credentials' })
    }
    return send(res, 200, issue(String(body.email).toLowerCase()))
  }

  const rest = url.pathname.match(/^\/rest\/v1\/(\w+)$/)
  if (!rest) return send(res, 404, { message: 'unbekannter Pfad' })
  const table = rest[1]

  if (req.headers.apikey !== ANON) return send(res, 401, { message: 'Ungültiger Projektschlüssel' })
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const session = tokens.get(auth)
  if (!session) return send(res, 401, { message: 'Nicht angemeldet' })

  try {
    if (req.method === 'GET') {
      const gt = (url.searchParams.get('server_rev') || 'gt.0').replace('gt.', '')
      const limit = Number(url.searchParams.get('limit') || 500)
      const rows = await asUser(session.user, async (c) => {
        const r = await c.query(
          `SELECT * FROM ${table} WHERE server_rev > $1 ORDER BY server_rev ASC LIMIT $2`,
          [Number(gt), limit],
        )
        return r.rows
      })
      return send(res, 200, rows)
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      const list = Array.isArray(body) ? body : [body]
      if (!list.length) return send(res, 200, [])
      const cols = Object.keys(list[0])
      const out = await asUser(session.user, async (c) => {
        const saved = []
        for (const row of list) {
          const values = cols.map((k) => row[k])
          const holes = cols.map((_, i) => `$${i + 1}`)
          const updates = cols.filter((k) => k !== 'id').map((k) => `${k} = EXCLUDED.${k}`)
          const r = await c.query(
            `INSERT INTO ${table} (${cols.join(',')}) VALUES (${holes.join(',')})
             ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}
             RETURNING *`,
            values,
          )
          saved.push(...r.rows)
        }
        return saved
      })
      return send(res, 200, out)
    }
  } catch (e) {
    return send(res, 400, { message: String(e.message || e) })
  }
  return send(res, 405, { message: 'Methode nicht unterstützt' })
})

server.listen(PORT, () => console.log(`mock-supabase auf http://127.0.0.1:${PORT}`))
