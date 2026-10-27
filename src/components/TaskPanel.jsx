import { useState, useEffect } from 'react'
import { safeExternalUrl, STATUS_COLOR } from '../utils/projectUtils'

const STATUSES = ['not_started', 'in_progress', 'at_risk', 'overdue', 'complete']
const TYPES    = ['task', 'milestone']

export default function TaskPanel({ task, allTasks, onSave, onDelete, onClose, onDepsChange }) {
  const [form,       setForm]       = useState({})
  const [depFilter,  setDepFilter]  = useState('')

  useEffect(() => {
    setForm(task ? { ...task } : {})
    setDepFilter('')
  }, [task])

  if (!task) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // dependencies stored as comma-separated task_ids
  const currentDeps = form.dependencies
    ? form.dependencies.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const toggleDep = (taskId) => {
    const next = currentDeps.includes(taskId)
      ? currentDeps.filter(d => d !== taskId)
      : [...currentDeps, taskId]
    const val = next.join(',')
    set('dependencies', val)
    onDepsChange?.(form.task_id, next)
  }

  // Build set of task IDs that are downstream of the current task
  // (tasks that directly or transitively depend on it) — these would create cycles
  const getDownstream = (rootId) => {
    const downstream = new Set()
    const visit = (id) => {
      allTasks.forEach(t => {
        const deps = t.dependencies ? t.dependencies.split(',').map(s => s.trim()).filter(Boolean) : []
        if (deps.includes(id) && !downstream.has(t.task_id)) {
          downstream.add(t.task_id)
          visit(t.task_id)
        }
      })
    }
    visit(rootId)
    return downstream
  }
  const downstream = getDownstream(form.task_id)

  const candidates = allTasks
    .filter(t => t.task_id !== form.task_id)
    .filter(t => !downstream.has(t.task_id))
    .filter(t => depFilter === '' ||
      t.task_name.toLowerCase().includes(depFilter.toLowerCase()) ||
      t.task_id.toLowerCase().includes(depFilter.toLowerCase())
    )

  const labelStyle = { fontSize: 11, color: '#aaa', marginBottom: 3, marginTop: 10 }
  const inputStyle = {
    width: '100%', background: '#2a2a3e', border: '1px solid #444',
    borderRadius: 6, color: '#fff', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box',
  }
  const color = STATUS_COLOR[form.status] ?? '#9E9E9E'

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 290,
      background: '#16161f', borderLeft: `3px solid ${color}`,
      padding: 16, overflowY: 'auto', zIndex: 10, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Edit Task</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>

      <div style={labelStyle}>Task Name</div>
      <input style={inputStyle} value={form.task_name ?? ''} onChange={e => set('task_name', e.target.value)} />

      <div style={labelStyle}>Type</div>
      <select style={inputStyle} value={form.type ?? 'task'} onChange={e => set('type', e.target.value)}>
        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <div style={labelStyle}>Status</div>
      <select style={inputStyle} value={form.status ?? 'not_started'} onChange={e => set('status', e.target.value)}>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <div style={labelStyle}>Assignee</div>
      <input style={inputStyle} value={form.assignee ?? ''} onChange={e => set('assignee', e.target.value)} />

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Start Date</div>
          <input type="date" style={inputStyle} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>End Date</div>
          <input type="date" style={inputStyle} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value)} />
        </div>
      </div>
      <input type="range" min="0" max="100" style={{ width: '100%' }}
        value={form.progress ?? 0} onChange={e => set('progress', e.target.value)} />

      {/* ── Scheduling mode ───────────────────────────────────────────── */}
      <div style={labelStyle}>Scheduling Mode</div>
      <div style={{ display: 'flex', gap: 0, background: '#0f0f17', borderRadius: 6, padding: 2, marginBottom: 2 }}>
        {['fixed', 'dynamic'].map(mode => (
          <button key={mode} onClick={() => set('date_mode', mode)} style={{
            flex: 1, border: 'none', borderRadius: 5, padding: '5px 0', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: (form.date_mode ?? 'fixed') === mode ? '#2a2a3e' : 'transparent',
            color: (form.date_mode ?? 'fixed') === mode ? '#fff' : '#666',
          }}>
            {mode === 'fixed' ? '📅 Fixed Dates' : '⛓ After Dependencies'}
          </button>
        ))}
      </div>

      {(form.date_mode ?? 'fixed') === 'fixed' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Start Date</div>
            <input type="date" style={inputStyle} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>End Date</div>
            <input type="date" style={inputStyle} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <div style={labelStyle}>Duration (days)</div>
          <input
            type="number" min="1" style={inputStyle}
            placeholder="e.g. 7"
            value={form.duration_days ?? ''}
            onChange={e => set('duration_days', e.target.value)}
          />
          <div style={{ color: '#555', fontSize: 11, marginTop: 4 }}>
            Starts the day after the latest dependency ends. Dates are computed automatically.
          </div>
        </div>
      )}

      <div style={labelStyle}>Progress ({form.progress ?? 0}%)</div>
      <div style={labelStyle}>
        Dependencies
        {currentDeps.length > 0 && (
          <span style={{
            marginLeft: 6, background: color, color: '#fff',
            borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700,
          }}>{currentDeps.length}</span>
        )}
      </div>
      <input
        style={{ ...inputStyle, marginBottom: 4 }}
        placeholder="Filter tasks…"
        value={depFilter}
        onChange={e => setDepFilter(e.target.value)}
      />
      <div style={{
        background: '#2a2a3e', border: '1px solid #444', borderRadius: 6,
        maxHeight: 160, overflowY: 'auto',
      }}>
        {candidates.length === 0 && (
          <div style={{ color: '#555', fontSize: 12, padding: '8px 10px' }}>No tasks found.</div>
        )}
        {candidates.map(t => {
          const checked = currentDeps.includes(t.task_id)
          return (
            <label key={t.task_id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', cursor: 'pointer',
              background: checked ? 'rgba(124,77,255,0.15)' : 'transparent',
              borderBottom: '1px solid #333',
            }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleDep(t.task_id)}
                style={{ accentColor: color, width: 14, height: 14, cursor: 'pointer' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.task_name}
                </div>
                <div style={{ color: STATUS_COLOR[t.status] ?? '#666', fontSize: 10 }}>{t.status}</div>
              </div>
            </label>
          )
        })}
      </div>

      <div style={labelStyle}>Google Drive / File Link</div>
      <input style={inputStyle} placeholder="https://drive.google.com/..."
        value={form.file_link ?? ''} onChange={e => set('file_link', e.target.value)} />
      {safeExternalUrl(form.file_link) && (
        <a href={safeExternalUrl(form.file_link)} target="_blank" rel="noreferrer"
          style={{ fontSize: 11, color: '#2196F3', marginTop: 4 }}>Open link ↗</a>
      )}

      <div style={labelStyle}>Notes</div>
      <textarea style={{ ...inputStyle, height: 70, resize: 'vertical' }}
        value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => onSave(form)} style={{
          flex: 1, background: color, border: 'none', borderRadius: 6,
          color: '#fff', fontWeight: 700, padding: '8px 0', cursor: 'pointer', fontSize: 13,
        }}>Save</button>
        <button onClick={() => onDelete(form.task_id)} style={{
          background: '#333', border: 'none', borderRadius: 6,
          color: '#F44336', fontWeight: 700, padding: '8px 12px', cursor: 'pointer', fontSize: 13,
        }}>Delete</button>
      </div>
    </div>
  )
}
