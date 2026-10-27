import { useEffect, useState } from 'react'
import { loadHistory, restoreRevision } from '../utils/driveApi'
import { useStore } from '../store/useStore'

function VersionList({ title, versions, busy, onRestore }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ color: '#aaa', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{title}</div>
      {!versions?.length ? (
        <div style={{ color: '#555', fontSize: 13, padding: '8px 0' }}>No versions in the last 7 days.</div>
      ) : versions.map((version, index) => {
        const date = new Date(version.modifiedTime)
        const user = version.lastModifyingUser?.displayName
        return (
          <div key={version.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px', marginBottom: 6, background: '#1e1e2e', borderRadius: 8,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#ddd', fontSize: 13 }}>{date.toLocaleString()}</div>
              <div style={{ color: '#666', fontSize: 11, marginTop: 3 }}>
                {index === 0 ? 'Current version' : 'Earlier version'}
                {user ? ` · ${user}` : ''}
              </div>
            </div>
            <button disabled={busy || index === 0} onClick={() => onRestore(version)} style={{
              background: index === 0 || busy ? '#333' : '#7c4dff', border: 'none', borderRadius: 6,
              color: index === 0 || busy ? '#777' : '#fff', padding: '6px 10px', cursor: index === 0 || busy ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}>Restore</button>
          </div>
        )
      })}
    </section>
  )
}

export default function VersionHistoryPanel({ onClose }) {
  const loadFromDrive = useStore(s => s.loadFromDrive)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    loadHistory().then(data => {
      if (active) setHistory(data)
    }).catch(e => {
      if (active) setError(`Could not load version history: ${e.message}`)
    })
    return () => { active = false }
  }, [])

  const handleRestore = async (revision) => {
    const date = new Date(revision.modifiedTime).toLocaleString()
    const label = revision.kind === 'projects' ? 'project/task data' : 'settings and categories'
    if (!window.confirm(`Restore ${label} to the version from ${date}? This will create a new version, so the current data remains recoverable.`)) return
    setBusy(true)
    setError('')
    try {
      await restoreRevision(revision)
      await loadFromDrive()
      setHistory(await loadHistory())
    } catch (e) {
      setError(`Could not restore this version: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.72)',
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(520px, 100%)', height: '100%', overflowY: 'auto',
        background: '#16161f', borderLeft: '1px solid #333', padding: 22, boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 17, flex: 1 }}>Version History</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ color: '#666', fontSize: 12, lineHeight: 1.5, marginBottom: 18 }}>
          Drive keeps recoverable versions of saved board data for up to 7 days. Restoring a version saves it as a new version.
        </div>
        {error && <div style={{ color: '#F44336', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {!history && !error && <div style={{ color: '#888', fontSize: 13 }}>Loading versions…</div>}
        {history && <>
          <VersionList title="Projects and Tasks" versions={history.projects} busy={busy} onRestore={handleRestore} />
          <VersionList title="Settings and Categories" versions={history.settings} busy={busy} onRestore={handleRestore} />
        </>}
      </div>
    </div>
  )
}
