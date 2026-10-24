// Uses the browser's built-in Web Crypto API — no dependencies, no cost.
// PBKDF2 with 310,000 iterations (OWASP 2023 recommendation for SHA-256).

const ITERATIONS = 310_000
const HASH       = 'SHA-256'
const KEY_LEN    = 32

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export async function hashPassword(password) {
  const salt      = crypto.getRandomValues(new Uint8Array(16))
  const keyMat    = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits      = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH }, keyMat, KEY_LEN * 8)
  return bufToHex(salt) + ':' + bufToHex(bits)
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt   = hexToBuf(saltHex)
  const keyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits   = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH }, keyMat, KEY_LEN * 8)
  // constant-time comparison
  const a = new Uint8Array(bits)
  const b = hexToBuf(hashHex)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
