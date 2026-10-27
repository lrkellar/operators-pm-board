// Google Drive API utility
// Uses the GIS (Google Identity Services) token client for OAuth
// and the Drive REST API v3 for file operations.
// All app files are stored in a dedicated folder in the user's Drive.

const FOLDER_NAME  = 'OperatorsPMBoard'
const CSV_FILENAME = 'projects.csv'
const JSON_FILENAME = 'settings.json'
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

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

async function listRevisions(fileId) {
  const revisions = []
  let pageToken
  do {
    const params = new URLSearchParams({
      pageSize: '100',
      fields: 'nextPageToken,revisions(id,modifiedTime,keepForever,lastModifyingUser(displayName,emailAddress))',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/revisions?${params}`,
      { headers: authHeaders() },
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message ?? 'Could not load Drive revision history')
    revisions.push(...(data.revisions ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return revisions
}

async function setRevisionRetention(fileId, revisionId, keepForever) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${revisionId}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepForever }),
    },
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error?.message ?? 'Could not update Drive revision retention')
  }
}

// Drive already stores each CSV/JSON upload as a revision. Pin revisions for
// the requested seven-day rollback window, then release older pinned versions.
async function maintainRevisionWindow(fileId) {
  const cutoff = Date.now() - HISTORY_WINDOW_MS
  const [revisions, fileResponse] = await Promise.all([
    listRevisions(fileId),
    fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId`, { headers: authHeaders() }),
  ])
  const file = await fileResponse.json()
  if (!fileResponse.ok) throw new Error(file.error?.message ?? 'Could not inspect Drive revision history')
  for (const revision of revisions) {
    const recent = new Date(revision.modifiedTime).getTime() >= cutoff
    const isHead = revision.id === file.headRevisionId
    if (isHead) continue // The current file body is always available from files.get.
    if (recent && !revision.keepForever) {
      await setRevisionRetention(fileId, revision.id, true)
    } else if (!recent && revision.keepForever) {
      await setRevisionRetention(fileId, revision.id, false)
    }
  }
  return { revisions, headId: file.headRevisionId }
}

async function writeFile(folderId, filename, existingId, content, mimeType = 'text/plain') {
  const meta = existingId ? null : { name: filename, parents: [folderId] }
  const historyBeforeWrite = existingId ? await maintainRevisionWindow(existingId) : null
  const url  = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
  const method = existingId ? 'PATCH' : 'POST'

  const body = new FormData()
  if (meta) body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }))
  body.append('file', new Blob([content], { type: mimeType }))

  const res = await fetch(url, { method, headers: authHeaders(), body })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error?.message ?? `Could not save ${filename}`)
  }
  const previousHead = historyBeforeWrite?.revisions.find(revision => revision.id === historyBeforeWrite.headId)
  if (previousHead) {
    const recent = Date.now() - new Date(previousHead.modifiedTime).getTime() <= HISTORY_WINDOW_MS
    if (recent && !previousHead.keepForever) {
      await setRevisionRetention(existingId, previousHead.id, true)
    } else if (!recent && previousHead.keepForever) {
      await setRevisionRetention(existingId, previousHead.id, false)
    }
  }
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
  if (existingId && await readFile(existingId) === csvText) return
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
  const content = JSON.stringify(obj, null, 2)
  if (existingId && await readFile(existingId) === content) return
  await writeFile(folderId, JSON_FILENAME, existingId, content, 'application/json')
}

export async function loadHistory() {
  const folderId = await getOrCreateFolder()
  const [csvId, settingsId] = await Promise.all([
    findFile(folderId, CSV_FILENAME),
    findFile(folderId, JSON_FILENAME),
  ])
  const [csv, settings] = await Promise.all([
    csvId ? maintainRevisionWindow(csvId).then(history => history.revisions) : [],
    settingsId ? maintainRevisionWindow(settingsId).then(history => history.revisions) : [],
  ])
  const current = Date.now()
  const inWindow = revisions => revisions
    .filter(revision => current - new Date(revision.modifiedTime).getTime() <= HISTORY_WINDOW_MS)
    .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
  return {
    projects: inWindow(csv).map(revision => ({ ...revision, fileId: csvId, kind: 'projects' })),
    settings: inWindow(settings).map(revision => ({ ...revision, fileId: settingsId, kind: 'settings' })),
  }
}

export async function restoreRevision({ fileId, revisionId, kind }) {
  const folderId = await getOrCreateFolder()
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${revisionId}?alt=media`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error?.message ?? 'Could not download the selected version')
  }
  const content = await response.text()
  const filename = kind === 'settings' ? JSON_FILENAME : CSV_FILENAME
  const mimeType = kind === 'settings' ? 'application/json' : 'text/csv'
  await writeFile(folderId, filename, fileId, content, mimeType)
}
