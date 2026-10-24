import { useState } from 'react'
import { useStore } from '../store/useStore'

// This page is only reachable when zero users exist in the store,
// or when the user navigates to /#/setup with a valid invite code.

export default function Setup({ onDone }) {
  const { createUserWithInvite, loadDemoData, login } = useStore()
  const [form,  setForm]  = useState({ username: '', password: '', confirm: '', invite: '' })
  const [demo,  setDemo]  = useState(true)
  const [error, setError] = useState('')
  const [busy,  setBusy]  = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    const err = await createUserWithInvite(form.username, form.password, form.invite)
    if (err) { setError(err); setBusy(false); return }
    await login(form.username, form.password)
    if (demo) await loadDemoData()
    setBusy(false)
    onDone?.()
  }

  const inputStyle = {
    width: '100%', background: '#1e1e2e', border: '1px solid #444',
    borderRadius: 8, color: '#fff', padding: '10px 12px',
    fontSize: 14, boxSizing: 'border-box', marginBottom: 12,
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0f0f17',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#16161f', border: '1px solid #7c4dff',
        borderRadius: 16, padding: 32, width: '100%', maxWidth: 400,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 36 }}>🔐</div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>Create Account</div>
          <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>Invite code required</div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="on">
          <input style={inputStyle} name="username" autoComplete="username"
            placeholder="Username (3–32 alphanumeric)"
            value={form.username} onChange={e => set('username', e.target.value)} />
          <input style={inputStyle} name="password" type="password" autoComplete="new-password"
            placeholder="Password (min 8 characters)"
            value={form.password} onChange={e => set('password', e.target.value)} />
          <input style={inputStyle} name="confirm" type="password" autoComplete="new-password"
            placeholder="Confirm password"
            value={form.confirm} onChange={e => set('confirm', e.target.value)} />
          <input style={{ ...inputStyle, letterSpacing: 2 }} name="invite"
            placeholder="Invite code"
            value={form.invite} onChange={e => set('invite', e.target.value)} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#aaa', fontSize: 13, marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} />
            Load demo projects (3 sample projects)
          </label>

          {error && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 10 }}>{error}</div>}

          <button type="submit" disabled={busy} style={{
            width: '100%', background: busy ? '#444' : '#7c4dff',
            border: 'none', borderRadius: 8, color: '#fff',
            fontWeight: 700, fontSize: 15, padding: '11px 0',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}>
            {busy ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
