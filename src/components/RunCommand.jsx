import { useState } from 'react'

// Where the board's code lives on this PC. Used to show the exact commands that start the local helpers.
const KEY = 'opm.boardFolder'
const DEFAULT_FOLDER = 'C:\\Users\\Admin\\Desktop\\Programming\\operators-pm-board'

export function getBoardFolder() {
  try { return localStorage.getItem(KEY) || DEFAULT_FOLDER } catch { return DEFAULT_FOLDER }
}
function setBoardFolder(value) {
  try { localStorage.setItem(KEY, value) } catch { /* private window: keep the default */ }
}

// A copyable block of terminal commands: cd into the board folder, then run `command`.
// `launcher` names the .cmd file in that folder that does the same on a double-click.
export default function RunCommand({ command, launcher, note }) {
  const [folder, setFolder] = useState(getBoardFolder)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const text = `cd /d "${folder}"\n${command}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked: the text is still selectable */ }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ color: '#aaa', fontSize: 12, lineHeight: 1.5, marginBottom: 6 }}>
        Open a Command Prompt (Windows key, type <b>cmd</b>, Enter) and run:
      </div>
      <div style={{ position: 'relative', background: '#0b0b12', border: '1px solid #2a2a3e', borderRadius: 8, padding: '10px 12px', paddingRight: 70 }}>
        <pre style={{ margin: 0, fontFamily: 'Consolas, Menlo, monospace', fontSize: 12, color: '#cfe8cf', whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'all' }}>{text}</pre>
        <button onClick={copy} style={{
          position: 'absolute', top: 8, right: 8, background: copied ? '#2e7d32' : '#2a2a3e', border: 'none', borderRadius: 5,
          color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 9px', cursor: 'pointer',
        }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div style={{ color: '#777', fontSize: 11.5, lineHeight: 1.6, marginTop: 6 }}>
        {note ?? 'Leave that window open while you use it. Closing it stops it.'}
        {launcher && <> Or double-click <b>{launcher}</b> in the board folder.</>}{' '}
        {editing ? (
          <span style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input value={folder} onChange={e => setFolder(e.target.value)} style={{
              flex: 1, background: '#1e1e2e', border: '1px solid #444', borderRadius: 5, color: '#fff', fontSize: 11.5, padding: '4px 6px',
            }} />
            <button onClick={() => { setBoardFolder(folder.trim() || DEFAULT_FOLDER); setFolder(f => f.trim() || DEFAULT_FOLDER); setEditing(false) }}
              style={{ background: '#7c4dff', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, padding: '4px 9px', cursor: 'pointer' }}>Save</button>
          </span>
        ) : (
          <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: '#9fa8da', fontSize: 11.5, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
            Board folder somewhere else?
          </button>
        )}
      </div>
    </div>
  )
}
