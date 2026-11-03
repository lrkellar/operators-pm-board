import { createServer } from 'node:http'
import { setToken } from '../src/utils/driveApi.js'

const PORT = Number(process.env.OPM_MCP_PORT ?? 43127)
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://lrkellar.github.io',
]
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...(process.env.OPM_MCP_ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean),
])

let googleSession = null

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

function setCors(request, response) {
  const origin = request.headers.origin
  if (!origin) return true
  if (!ALLOWED_ORIGINS.has(origin)) return false
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (request.headers['access-control-request-private-network'] === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  response.setHeader('Access-Control-Max-Age', '600')
  response.setHeader('Vary', 'Origin')
  return true
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 8192) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function status() {
  const connected = Boolean(googleSession && googleSession.expiresAt > Date.now())
  if (!connected) {
    googleSession = null
    setToken(null)
  }
  return {
    connected,
    email: connected ? googleSession.email : null,
    expiresAt: connected ? googleSession.expiresAt : null,
  }
}

async function handleRequest(request, response) {
  if (!setCors(request, response)) return sendJson(response, 403, { error: 'This app origin is not allowed to connect to the local board bridge.' })
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    return response.end()
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/status' && request.method === 'GET') return sendJson(response, 200, status())

  if (url.pathname === '/session' && request.method === 'POST') {
    try {
      const payload = await readJson(request)
      const accessToken = payload.accessToken
      const expiresAt = Number(payload.expiresAt)
      if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 4096) {
        return sendJson(response, 400, { error: 'A valid Google session token is required.' })
      }
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 70 * 60 * 1000) {
        return sendJson(response, 400, { error: 'The Google session expiry is invalid or too far in the future.' })
      }

      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const profile = await profileResponse.json().catch(() => ({}))
      if (!profileResponse.ok || !profile.email) {
        return sendJson(response, 401, { error: 'Google rejected this session. Sign in again in the board and reconnect.' })
      }

      // Keep the user's short-lived OAuth session in memory only.
      googleSession = { accessToken, expiresAt, email: profile.email }
      return sendJson(response, 200, status())
    } catch (error) {
      return sendJson(response, 400, { error: error.message || 'Could not read the connection request.' })
    }
  }

  if (url.pathname === '/session' && request.method === 'DELETE') {
    googleSession = null
    setToken(null)
    return sendJson(response, 200, status())
  }

  sendJson(response, 404, { error: 'Not found' })
}

const bridge = createServer((request, response) => { void handleRequest(request, response) })
bridge.on('error', error => console.error(`Local board bridge error: ${error.message}`))
bridge.listen(PORT, '127.0.0.1', () => {
  console.error(`Operators PM Board local session bridge listening on 127.0.0.1:${PORT}`)
})

export function getGoogleSession() {
  const current = status()
  return current.connected ? googleSession : null
}

export function closeSessionBridge() {
  googleSession = null
  setToken(null)
  bridge.close()
}
