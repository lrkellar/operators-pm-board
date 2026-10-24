// Google Drive API utility
// Uses the GIS (Google Identity Services) token client for OAuth
// and the Drive REST API v3 for file operations.
// All app files are stored in a dedicated folder in the user's Drive.

const FOLDER_NAME  = 'OperatorsPMBoard'
const CSV_FILENAME = 'projects.csv'
const JSON_FILENAME = 'settings.json'

let _token = null  // current access token

export function setToken(token) { _token = token }
export function getToken()      { return _token }

function authHeaders() {
  return { Authorization: `Bearer ${_token}` }
}

// ── Folder management ─────────────────────────────────────────────────────────

async function getOrCreateFolder() {
  // Search for existing folder
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: authHeaders() }
  )
  const data = await res.json()
  if (data.files?.length > 0) return data.files[0].id

  // Create folder
  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })
  const folder = await create.json()
  return folder.id
}

// ── File operations ───────────────────────────────────────────────────────────

async function findFile(folderId, filename) {
  const q = encodeURIComponent(
    `name='${filename}' and '${folderId}' in parents and trashed=false`
  )
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: authHeaders() }
  )
  const data = await res.json()
  return data.files?.[0]?.id ?? null
}

async function readFile(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: authHeaders() }
  )
  return res.text()
}

async function writeFile(folderId, filename, existingId, content, mimeType = 'text/plain') {
  const meta = existingId ? null : { name: filename, parents: [folderId] }
  const url  = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
  const method = existingId ? 'PATCH' : 'POST'

  const body = new FormData()
  if (meta) body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }))
  body.append('file', new Blob([content], { type: mimeType }))

  await fetch(url, { method, headers: authHeaders(), body })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadCSV() {
  const folderId = await getOrCreateFolder()
  const fileId   = await findFile(folderId, CSV_FILENAME)
  if (!fileId) return null
  return readFile(fileId)
}

export async function saveCSV(csvText) {
  const folderId   = await getOrCreateFolder()
  const existingId = await findFile(folderId, CSV_FILENAME)
  await writeFile(folderId, CSV_FILENAME, existingId, csvText, 'text/csv')
}

export async function loadSettings() {
  const folderId = await getOrCreateFolder()
  const fileId   = await findFile(folderId, JSON_FILENAME)
  if (!fileId) return null
  const text = await readFile(fileId)
  try { return JSON.parse(text) } catch { return null }
}

export async function saveSettings(obj) {
  const folderId   = await getOrCreateFolder()
  const existingId = await findFile(folderId, JSON_FILENAME)
  await writeFile(folderId, JSON_FILENAME, existingId, JSON.stringify(obj, null, 2), 'application/json')
}
