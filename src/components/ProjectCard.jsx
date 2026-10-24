import { useState } from 'react'
import { STATUS_COLOR, STATUS_LABEL, pressingTask, projectHealth, tasksWithResolvedDates } from '../utils/projectUtils'
import GanttChart from './GanttChart'

export default function ProjectCard({ project, viewMode, onEdit, onDelete, categoryColor, onTaskClick }) {
  const [expanded,   setExpanded]  = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const tasks       = tasksWithResolvedDates(project.tasks)
  const health      = projectHealth(tasks)
  const statusColor = STATUS_COLOR[health]
  const identColor  = categoryColor ?? '#2a2a3e'
  const next        = pressingTask(tasks)
  const total       = tasks.length
  const done        = tasks.filter(t => t.status === 'complete').length

  // card bg tints based on status
  const cardBg = {
    overdue:     'rgba(244,67,54,0.08)',
    at_risk:     'rgba(255,152,0,0.08)',
    in_progress: 'rgba(33,150,243,0.06)',
    complete:    'rgba(76,175,80,0.06)',
    not_started: '#16161f',
  }[health] ?? '#16161f'

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${expanded ? statusColor : '#2a2a3e'}`,
      borderRadius: 12,
      marginBottom: 16,
      overflow: 'hidden',
      transition: 'background 0.3s, border-color 0.2s',
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px', cursor: 'pointer',
          borderLeft: `5px solid ${identColor}`,  // category color = identity
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{project.name}</span>
            {/* status badge */}
            <span style={{
              background: statusColor, color: '#fff', borderRadius: 12,
              padding: '2px 10px', fontSize: 11, fontWeight: 600,
            }}>{STATUS_LABEL[health]}</span>
            <span style={{ color: '#666', fontSize: 12 }}>{done}/{total} tasks</span>
          </div>
          {next ? (
            <div
              onClick={e => { e.stopPropagation(); onTaskClick?.(next.task_id) }}
              style={{ color: '#aaa', fontSize: 12, marginTop: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <span style={{ color: STATUS_COLOR[next.status] }}>▶ </span>
              <span style={{ color: '#ccc', textDecoration: 'underline', textDecorationColor: '#444' }}>{next.task_name}</span>
              <span style={{ color: '#555' }}>· due {next.end_date} · {next.assignee}</span>
            </div>
          ) : (
            <div style={{ color: '#4CAF50', fontSize: 12, marginTop: 4 }}>All tasks complete 🎉</div>
          )}
        </div>

        {/* progress bar — category color fill */}
        <div style={{ width: 80, background: '#2a2a3e', borderRadius: 4, height: 6 }}>
          <div style={{
            width: `${Math.round((done / total) * 100)}%`,
            background: identColor !== '#2a2a3e' ? identColor : statusColor,
            height: '100%', borderRadius: 4, transition: 'width 0.4s',
          }} />
        </div>

        <button onClick={e => { e.stopPropagation(); onEdit(project.id) }} style={{
          background: '#2a2a3e', border: 'none', borderRadius: 6,
          color: '#aaa', padding: '5px 10px', cursor: 'pointer', fontSize: 12,
        }}>Edit ✏️</button>

        {confirmDel ? (
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            <span style={{ color: '#F44336', fontSize: 12, alignSelf: 'center' }}>Delete?</span>
            <button onClick={e => { e.stopPropagation(); onDelete(project.id) }} style={{
              background: '#F44336', border: 'none', borderRadius: 6,
              color: '#fff', padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
            }}>Yes</button>
            <button onClick={e => { e.stopPropagation(); setConfirmDel(false) }} style={{
              background: '#2a2a3e', border: 'none', borderRadius: 6,
              color: '#aaa', padding: '5px 10px', cursor: 'pointer', fontSize: 12,
            }}>No</button>
          </div>
        ) : (
          <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }} style={{
            background: '#2a2a3e', border: 'none', borderRadius: 6,
            color: '#F44336', padding: '5px 10px', cursor: 'pointer', fontSize: 12,
          }}>🗑</button>
        )}

        <span style={{ color: '#555', fontSize: 18 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${statusColor}33`, padding: '12px 18px' }}>
          {viewMode === 'Gantt' && <GanttChart tasks={tasks} />}
          {viewMode === 'CPM' && (
            <div style={{ color: '#aaa', padding: '20px 0', textAlign: 'center', fontSize: 13 }}>
              🔧 Critical Path view coming soon.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
