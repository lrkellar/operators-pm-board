import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import RunCommand, { getBoardFolder } from './RunCommand'

const BRIDGE_URL = 'http://127.0.0.1:43127'

async function readResponse(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `Local connector returned ${response.status}`)
  return body
}

export default function AIConnectorPanel({ onClose }) {
  const currentUser = useStore(state => state.currentUser)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const check = useCallback(() => fetch(`${BRIDGE_URL}/status`, { cache: 'no-store' })
    .then(readResponse)
    .then(nextStatus => { setStatus(nextStatus); return nextStatus })
    .catch(() => { setStatus({ connected: false, unavailable: true }); return null }), [])

  useEffect(() => { check() }, [check])

  // While the connector is not running, keep looking, so the panel notices as soon as it is started.
  const unavailable = status?.unavailable
  useEffect(() => {
    if (!unavailable) return
    const timer = setInterval(check, 3000)
    return () => clearInterval(timer)
  }, [unavailable, check])

  const connect = async () => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      if (!currentUser?.accessToken) throw new Error('Sign in to the board first.')
      if (!currentUser?.expiresAt || currentUser.expiresAt <= Date.now()) throw new Error('Your Google session has expired. Log out, sign in again, then reconnect.')
      const response = await fetch(`${BRIDGE_URL}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: currentUser.accessToken, expiresAt: currentUser.expiresAt }),
      })
      const nextStatus = await readResponse(response)
      setStatus(nextStatus)
      setMessage(`Connected as ${nextStatus.email}. This Google session stays in local memory until it expires or you disconnect.`)
    } catch (e) {
      if (/fetch|network/i.test(e.message)) {
        setStatus({ connected: false, unavailable: true })
        setError('The connector is not running on this computer. Start it with the commands above, then click Connect again.')
      } else setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${BRIDGE_URL}/session`, { method: 'DELETE' })
      setStatus(await readResponse(response))
      setMessage('Disconnected. Claude can no longer access this board session.')
    } catch {
      setError('Could not reach the local MCP process to disconnect the session.')
    } finally {
      setBusy(false)
    }
  }

  const expires = status?.expiresAt ? new Date(status.expiresAt).toLocaleTimeString() : null

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.72)',
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <aside onClick={event => event.stopPropagation()} style={{
        width: 'min(480px, 100%)', height: '100%', overflowY: 'auto',
        background: '#16161f', borderLeft: '1px solid #333', padding: 24, boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 17, flex: 1 }}>AI Connector</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ color: '#777', fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
          Connect Claude Desktop to this board through the local MCP process. Claude can read projects and tasks, add or update plans, and restore recent versions. The board’s Google session token is sent only to the local process, kept in memory, and expires with your Google session.
        </div>

        <div style={{ background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 9, padding: 14, marginBottom: 14 }}>
          <div style={{ color: '#aaa', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Local process</div>
          <div style={{ color: status?.unavailable ? '#FF9800' : '#ddd', fontSize: 13 }}>
            {status === null ? 'Checking…' : status.unavailable ? 'Not running' : status.connected ? `Connected · ${status.email}` : 'Running · not connected'}
          </div>
          {expires && <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>Google session expires around {expires}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy || !currentUser?.accessToken} onClick={connect} style={buttonStyle('#7c4dff', busy || !currentUser?.accessToken)}>
            {busy ? 'Connecting…' : status?.connected ? 'Reconnect' : 'Connect this session'}
          </button>
          {status?.connected && <button disabled={busy} onClick={disconnect} style={buttonStyle('#333', busy)}>Disconnect</button>}
        </div>

        {status?.unavailable && (
          <div style={{ background: '#2a1f12', border: '1px solid #FF9800', borderRadius: 9, padding: 14, marginTop: 14 }}>
            <div style={{ color: '#ffcc80', fontWeight: 700, fontSize: 13 }}>Start the connector</div>
            <RunCommand command={'node mcp\\server.js'} launcher="Start connector.cmd"
              note="You should see “local session bridge listening on 127.0.0.1:43127”. Leave that window open; this panel notices when it is running. For Claude Desktop to use the board tools in a chat, use the setup below instead, and close this window first." />
          </div>
        )}

        {message && <div role="status" style={{ color: '#4CAF50', fontSize: 12, lineHeight: 1.5, marginTop: 14 }}>{message}</div>}
        {error && <div role="alert" style={{ color: '#F44336', fontSize: 12, lineHeight: 1.5, marginTop: 14 }}>{error}</div>}

        <div style={{ borderTop: '1px solid #2a2a3e', marginTop: 22, paddingTop: 16 }}>
          <div style={{ color: '#aaa', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Claude Desktop setup</div>
          <div style={{ color: '#666', fontSize: 12, lineHeight: 1.6 }}>
            So Claude Desktop starts the connector itself: in Claude Desktop open <b>Settings → Developer → Edit Config</b>, add the
            entry below inside <code>"mcpServers"</code>, save, quit Claude from the tray icon and reopen it, then click Connect.
            No Anthropic API key is used. The Google session token is not saved to disk.
          </div>
          <DesktopConfig />
        </div>
      </aside>
    </div>
  )
}

const buttonStyle = (background, disabled) => ({
  background: disabled ? '#333' : background, border: 'none', borderRadius: 6,
  color: disabled ? '#777' : '#fff', padding: '8px 12px', cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 600, fontSize: 12,
})

function DesktopConfig() {
  const [copied, setCopied] = useState(false)
  const folder = getBoardFolder()
  const text = JSON.stringify({ 'operators-pm-board': { command: 'node', args: [`${folder}\\mcp\\server.js`] } }, null, 2)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text.slice(1, -1).trim()); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* selectable */ }
  }
  return (
    <div style={{ position: 'relative', background: '#0b0b12', border: '1px solid #2a2a3e', borderRadius: 8, padding: '10px 12px', paddingRight: 70, marginTop: 8 }}>
      <pre style={{ margin: 0, fontFamily: 'Consolas, Menlo, monospace', fontSize: 11.5, color: '#cfe8cf', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{text}</pre>
      <button onClick={copy} style={{ position: 'absolute', top: 8, right: 8, background: copied ? '#2e7d32' : '#2a2a3e', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 9px', cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}
