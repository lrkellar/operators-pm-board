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

// The browser's Google token lasts about an hour. The board registers a provider that hands back a
// fresh one (silently re-asking Google when needed); the local MCP connector has none and uses setToken.
let _tokenProvider = null  // async (force) => accessToken
export function setTokenProvider(fn) { _tokenProvider = fn }

// Every Drive call goes through here: fresh token first, and one retry with a new token on a 401.
async function driveFetch(url, options = {}) {
  if (_tokenProvider) _token = await _tokenProvider(false)
  const withToken = () => ({ ...options, headers: { ...(options.headers ?? {}), Authorization: `Bearer ${_token}` } })
  let res = await fetch(url, withToken())
  if (res.status === 401 && _tokenProvider) {
    _token = await _tokenProvider(true)
    res = await fetch(url, withToken())
  }
  return res
}

function authHeaders() {
  return { Authorization: `Bearer ${_token}` }
}

// ── Folder management ─────────────────────────────────────────────────────────

async function getOrCreateFolder() {
  // Search for existing folder
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: authHeaders() }
  )
  const data = await res.json()
  if (data.files?.length > 0) return data.files[0].id

  // Create folder
  const create = await driveFetch('https://www.googleapis.com/drive/v3/files', {
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
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: authHeaders() }
  )
  const data = await res.json()
  return data.files?.[0]?.id ?? null
}

async function readFile(fileId) {
  const res = await driveFetch(
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
    const res = await driveFetch(
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
  const res = await driveFetch(
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

// Drive does not allow un-pinning: "Once a blob file revision is set to Keep Forever, it can only be
// downloaded or deleted." So a pinned revision that has left the window is deleted (never the head).
async function releaseRevision(fileId, revisionId) {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${revisionId}`,
    { method: 'DELETE', headers: authHeaders() },
  )
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error?.message ?? 'Could not release an old Drive revision')
  }
}

// Drive already stores each CSV/JSON upload as a revision. Pin revisions for
// the requested seven-day rollback window, then release older pinned versions.
// History upkeep never blocks a save: a failure here is logged and the save goes ahead.
async function maintainRevisionWindow(fileId) {
  const cutoff = Date.now() - HISTORY_WINDOW_MS
  const [revisions, fileResponse] = await Promise.all([
    listRevisions(fileId),
    driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId`, { headers: authHeaders() }),
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
      await releaseRevision(fileId, revision.id)
    }
  }
  return { revisions, headId: file.headRevisionId }
}

async function writeFile(folderId, filename, existingId, content, mimeType = 'text/plain') {
  const historyBeforeWrite = existingId
    ? await maintainRevisionWindow(existingId).catch(e => { console.warn(`Drive history upkeep skipped for ${filename}: ${e.message}`); return null })
    : null
  let fileId = existingId
  if (!fileId) {
    const create = await driveFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: filename, parents: [folderId], mimeType }),
    })
    const created = await create.json()
    if (!create.ok) throw new Error(created.error?.message ?? `Could not create ${filename}`)
    fileId = created.id
  }

  // This update contains only media, so use Drive's simple upload format:
  // the raw file bytes with the file MIME type, not a FormData wrapper.
  const res = await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': mimeType },
      body: new Blob([content], { type: mimeType }),
    },
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error?.message ?? `Could not save ${filename}`)
  }
  const previousHead = historyBeforeWrite?.revisions.find(revision => revision.id === historyBeforeWrite.headId)
  if (previousHead) {
    const recent = Date.now() - new Date(previousHead.modifiedTime).getTime() <= HISTORY_WINDOW_MS
    try {
      if (recent && !previousHead.keepForever) {
        await setRevisionRetention(fileId, previousHead.id, true)
      } else if (!recent && previousHead.keepForever) {
        await releaseRevision(fileId, previousHead.id)
      }
    } catch (e) {
      console.warn(`Drive history upkeep skipped for ${filename}: ${e.message}`)
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

// Plans under review from Project Council (see councilPlans.js). Kept apart from projects.csv
// so draft plans never mix with live projects until a level is promoted.
const COUNCIL_FILENAME = 'council-plans.json'

export async function loadCouncil() {
  const folderId = await getOrCreateFolder()
  const fileId   = await findFile(folderId, COUNCIL_FILENAME)
  if (!fileId) return null
  return readFile(fileId)
}

export async function saveCouncil(text) {
  const folderId   = await getOrCreateFolder()
  const existingId = await findFile(folderId, COUNCIL_FILENAME)
  if (existingId && await readFile(existingId) === text) return
  await writeFile(folderId, COUNCIL_FILENAME, existingId, text, 'application/json')
}

export async function loadHistory() {
  const folderId = await getOrCreateFolder()
  const [csvId, settingsId] = await Promise.all([
    findFile(folderId, CSV_FILENAME),
    findFile(folderId, JSON_FILENAME),
  ])
  const [csv, settings] = await Promise.all([
    csvId ? maintainRevisionWindow(csvId).then(history => history.revisions).catch(() => listRevisions(csvId)) : [],
    settingsId ? maintainRevisionWindow(settingsId).then(history => history.revisions).catch(() => listRevisions(settingsId)) : [],
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
  const response = await driveFetch(
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
