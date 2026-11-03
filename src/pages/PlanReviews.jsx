import { useState } from 'react'
import { useStore } from '../store/useStore'
import { LEVEL_NAMES, LEVEL_STATUS, plansList, currentRevision } from '../utils/councilPlans'

// Plans that Project Council is building level by level. Each chip opens that level's gate.
export default function PlanReviews({ onBack, onOpenGate }) {
  const council          = useStore(s => s.council)
  const councilLoading   = useStore(s => s.councilLoading)
  const councilError     = useStore(s => s.councilError)
  const loadCouncilPlans = useStore(s => s.loadCouncilPlans)
  const importCouncilLevel = useStore(s => s.importCouncilLevel)
  const [message, setMessage] = useState('')
  const [error, setError]     = useState('')
  const plans = plansList(council)

  const handleImport = (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      setError(''); setMessage('')
      try {
        await importCouncilLevel(ev.target.result)
        setMessage('Level imported and ready for review.')
      } catch (err) {
        setError(err.message)
      }
    }
    reader.readAsText(file)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', color: '#fff' }}>
      <div style={bar}>
        <button onClick={onBack} style={btn('#333')}>← Back</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>Plan reviews</span>
        <button onClick={loadCouncilPlans} style={btn('#2a2a3e')}>{councilLoading ? 'Loading…' : '↻ Refresh'}</button>
        <label style={{ ...btn('#2a2a3e'), cursor: 'pointer' }} title="Load a gate file (plan/gates/L<n>-r<k>.json) written by the council">
          ⬆ Import level
          <input type="file" accept=".json,application/json" onChange={handleImport} style={{ display: 'none' }} />
        </label>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
        <p style={{ color: '#9a9ab0', fontSize: 13, lineHeight: 1.6, marginBottom: 20, maxWidth: 760 }}>
          Each plan is built in five levels, from a one-page outline down to 30–60 minute steps. A level only adds detail
          under what you approved above it. Open a level to review it item by item, then approve it or send it back.
        </p>
        {message && <div style={{ color: '#4CAF50', fontSize: 13, marginBottom: 12 }}>{message}</div>}
        {(error || councilError) && <div style={{ color: '#F44336', fontSize: 13, marginBottom: 12 }}>{error || councilError}</div>}

        {plans.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: '60px 0', lineHeight: 1.7 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🗂️</div>
            No plans under review yet.<br />
            The council publishes each level here, or use Import level to load a gate file.
          </div>
        ) : plans.map(plan => (
          <div key={plan.plan_id} style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{plan.name}</span>
              <span style={{ color: '#666', fontSize: 12 }}>{plan.plan_id}</span>
              <span style={{ color: '#666', fontSize: 12, marginLeft: 'auto' }}>
                Updated {plan.updated_at ? new Date(plan.updated_at).toLocaleString() : '—'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              {LEVEL_NAMES.map((name, n) => {
                const level = plan.levels?.[String(n)]
                const st = level ? (LEVEL_STATUS[level.status] ?? LEVEL_STATUS.drafting) : null
                const rev = currentRevision(level)
                const items = rev?.payload?.items?.length
                const flags = rev?.payload?.counts ?? {}
                const openDecs = (rev?.payload?.decisions ?? []).filter(d => d.due_here && d.status !== 'decided').length
                return (
                  <button key={n} disabled={!rev?.payload}
                    onClick={() => onOpenGate(plan.plan_id, n)}
                    style={{
                      textAlign: 'left', background: '#1e1e2e', borderRadius: 10, padding: '12px 14px',
                      border: `1px solid ${st ? st.color : '#2a2a3e'}`, color: '#fff',
                      cursor: rev?.payload ? 'pointer' : 'default', opacity: level ? 1 : 0.45,
                    }}>
                    <div style={{ fontSize: 11, color: '#888', fontWeight: 700 }}>L{n}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, margin: '2px 0 6px' }}>{name}</div>
                    <div style={{ fontSize: 12, color: st ? st.color : '#666', fontWeight: 600 }}>
                      {st ? st.label : 'Not started'}{rev ? ` · rev ${rev.revision}` : ''}
                    </div>
                    {items != null && (
                      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                        {items} items{flags.blocking ? ` · ${flags.blocking} blocking` : ''}{flags.major ? ` · ${flags.major} major` : ''}
                        {openDecs ? ` · ${openDecs} decision${openDecs > 1 ? 's' : ''} to make` : ''}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const bar = {
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 24px',
  background: '#16161f', borderBottom: '1px solid #2a2a3e', position: 'sticky', top: 0, zIndex: 5,
}
const card = { background: '#16161f', border: '1px solid #2a2a3e', borderRadius: 12, padding: 18, marginBottom: 16 }
const btn = (bg) => ({
  background: bg, border: 'none', borderRadius: 6, color: '#fff', padding: '6px 14px',
  cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4,
})
