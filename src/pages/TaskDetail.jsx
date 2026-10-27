import { useStore } from '../store/useStore'
import { safeExternalUrl, STATUS_COLOR, STATUS_LABEL, tasksWithResolvedDates } from '../utils/projectUtils'

export default function TaskDetail({ taskId, onBack, onEdit }) {
  const getRows = useStore(s => s.getRows)
  const rows    = getRows()

  const task = rows.find(r => r.task_id === taskId)
  if (!task) return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#555', fontSize: 16 }}>Task not found. <button onClick={onBack} style={linkBtn}>Go back</button></div>
    </div>
  )

  // Get resolved dates in context of the full project
  const projRows     = rows.filter(r => r.project_id === task.project_id)
  const resolved     = tasksWithResolvedDates(projRows)
  const resolvedTask = resolved.find(r => r.task_id === taskId) ?? task

  const color     = STATUS_COLOR[task.status] ?? '#9E9E9E'
  const statusLbl = STATUS_LABEL[task.status] ?? task.status

  // Resolve dependency names
  const depIds   = task.dependencies ? task.dependencies.split(',').map(s => s.trim()).filter(Boolean) : []
  const depTasks = depIds.map(id => rows.find(r => r.task_id === id)).filter(Boolean)

  // Find tasks that depend on this one
  const dependents = rows.filter(r => {
    if (r.project_id !== task.project_id) return false
    const deps = r.dependencies ? r.dependencies.split(',').map(s => s.trim()).filter(Boolean) : []
    return deps.includes(taskId)
  })

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )

  const Field = ({ label, value, valueColor }) => value ? (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'baseline' }}>
      <div style={{ color: '#555', fontSize: 12, minWidth: 110 }}>{label}</div>
      <div style={{ color: valueColor ?? '#ccc', fontSize: 13 }}>{value}</div>
    </div>
  ) : null

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', color: '#fff' }}>
      {/* header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px',
        background: '#16161f', borderBottom: `1px solid ${color}44`,
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <button onClick={onBack} style={{
          background: '#2a2a3e', border: 'none', borderRadius: 6,
          color: '#aaa', padding: '6px 14px', cursor: 'pointer', fontSize: 13,
        }}>← Back</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>{task.project_name}</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.type === 'milestone' ? '◆ ' : ''}{task.task_name}
          </div>
        </div>

        <span style={{
          background: color, color: '#fff', borderRadius: 12,
          padding: '4px 14px', fontSize: 12, fontWeight: 600, flexShrink: 0,
        }}>{statusLbl}</span>

        <button onClick={() => onEdit(task.project_id)} style={{
          background: '#7c4dff', border: 'none', borderRadius: 6,
          color: '#fff', padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        }}>Edit in Canvas ✏️</button>
      </div>

      {/* content */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px' }}>

        {/* progress bar */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: '#aaa', fontSize: 12 }}>Progress</span>
            <span style={{ color: color, fontWeight: 700, fontSize: 14 }}>{task.progress ?? 0}%</span>
          </div>
          <div style={{ background: '#2a2a3e', borderRadius: 8, height: 10 }}>
            <div style={{
              width: `${task.progress ?? 0}%`, background: color,
              height: '100%', borderRadius: 8, transition: 'width 0.4s',
            }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {/* left column */}
          <div>
            <Section title="Details">
              <Field label="Type"       value={task.type === 'milestone' ? '◆ Milestone' : '▣ Task'} />
              <Field label="Assignee"   value={task.assignee} />
              <Field label="Project"    value={task.project_name} />
            </Section>

            <Section title="Schedule">
              {task.date_mode === 'dynamic' ? (
                <>
                  <Field label="Mode"          value="⛓ After Dependencies" />
                  <Field label="Duration"      value={task.duration_days ? `${task.duration_days} days` : '—'} />
                  <Field label="Resolved Start" value={resolvedTask.start_date} valueColor="#aaa" />
                  <Field label="Resolved End"   value={resolvedTask.end_date}   valueColor="#aaa" />
                </>
              ) : (
                <>
                  <Field label="Mode"      value="📅 Fixed Dates" />
                  <Field label="Start Date" value={task.start_date} />
                  <Field label="End Date"   value={task.end_date} />
                </>
              )}
            </Section>
          </div>

          {/* right column */}
          <div>
            {depTasks.length > 0 && (
              <Section title={`Dependencies (${depTasks.length})`}>
                {depTasks.map(d => (
                  <div key={d.task_id} onClick={() => onBack(d.task_id)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: '#1e1e2e', borderRadius: 8, padding: '8px 12px', marginBottom: 6,
                    borderLeft: `3px solid ${STATUS_COLOR[d.status] ?? '#555'}`,
                    cursor: 'pointer',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#fff', fontSize: 13 }}>{d.task_name}</div>
                      <div style={{ color: '#555', fontSize: 11 }}>{d.end_date}</div>
                    </div>
                    <span style={{ fontSize: 11, color: STATUS_COLOR[d.status] }}>{d.status}</span>
                  </div>
                ))}
              </Section>
            )}

            {dependents.length > 0 && (
              <Section title={`Blocks (${dependents.length})`}>
                {dependents.map(d => (
                  <div key={d.task_id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: '#1e1e2e', borderRadius: 8, padding: '8px 12px', marginBottom: 6,
                    borderLeft: `3px solid ${STATUS_COLOR[d.status] ?? '#555'}`,
                    cursor: 'pointer',
                  }} onClick={() => onBack(d.task_id)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#fff', fontSize: 13 }}>{d.task_name}</div>
                      <div style={{ color: '#555', fontSize: 11 }}>{d.start_date}</div>
                    </div>
                    <span style={{ fontSize: 11, color: STATUS_COLOR[d.status] }}>{d.status}</span>
                  </div>
                ))}
              </Section>
            )}

            {safeExternalUrl(task.file_link) && (
              <Section title="File / Link">
                <a href={safeExternalUrl(task.file_link)} target="_blank" rel="noreferrer" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: '#1e1e2e', borderRadius: 8, padding: '8px 14px',
                  color: '#2196F3', fontSize: 13, textDecoration: 'none',
                  border: '1px solid #2a2a3e',
                }}>🔗 Open link ↗</a>
              </Section>
            )}
          </div>
        </div>

        {task.notes && (
          <Section title="Notes">
            <div style={{
              background: '#1e1e2e', borderRadius: 10, padding: '14px 16px',
              color: '#ccc', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
              border: '1px solid #2a2a3e',
            }}>{task.notes}</div>
          </Section>
        )}

      </div>
    </div>
  )
}

const linkBtn = {
  background: 'none', border: 'none', color: '#7c4dff', cursor: 'pointer', fontSize: 16,
}
