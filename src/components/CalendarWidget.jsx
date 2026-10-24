import { useState, useMemo } from 'react'
import { STATUS_COLOR, tasksWithResolvedDates } from '../utils/projectUtils'

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS     = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December']

const VIEW_MODES = [
  { key: '1d',  label: '1 Day',   days: 1  },
  { key: '3d',  label: '3 Days',  days: 3  },
  { key: '1w',  label: '1 Week',  days: 7  },
  { key: '1m',  label: 'Month',   days: null },
]

function isoDate(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
}

function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}

function startOfDay(d) {
  const x = new Date(d); x.setHours(0,0,0,0); return x
}

function startOfWeek(d) {
  const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x
}

function taskDays(task) {
  if (!task.start_date || !task.end_date) return []
  const start = startOfDay(new Date(task.start_date))
  const end   = startOfDay(new Date(task.end_date))
  if (isNaN(start) || isNaN(end)) return []
  const days = []
  let cur = new Date(start)
  while (cur <= end) { days.push(isoDate(cur)); cur = addDays(cur, 1) }
  return days
}

export default function CalendarWidget({ projects, categories, projectSettings, onTaskClick }) {
  const today    = startOfDay(new Date())
  const todayStr = isoDate(today)

  const [viewKey,   setViewKey]   = useState('1w')
  const [anchor,    setAnchor]    = useState(isoDate(today)) // start of current view window
  const [selected,  setSelected]  = useState(null)

  const viewDays = VIEW_MODES.find(v => v.key === viewKey)?.days ?? 7

  // Flatten resolved tasks
  const allTasks = useMemo(() => projects.flatMap(p => {
    const resolved = tasksWithResolvedDates(p.tasks)
    return resolved.map(t => ({ ...t, _projectName: p.name, _projectId: p.id }))
  }), [projects])

  const dayTaskMap = useMemo(() => {
    const map = {}
    allTasks.forEach(task => {
      taskDays(task).forEach(d => { if (!map[d]) map[d] = []; map[d].push(task) })
    })
    return map
  }, [allTasks])

  const getCatColor = (projectId) => {
    const catId = projectSettings[projectId]?.categoryId
    return catId && categories[catId] ? categories[catId].color : null
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const navigate = (dir) => {
    setSelected(null)
    if (viewKey === '1m') {
      const d = new Date(anchor + 'T12:00:00')
      d.setMonth(d.getMonth() + dir)
      d.setDate(1)
      setAnchor(isoDate(d))
    } else {
      const d = new Date(anchor + 'T12:00:00')
      d.setDate(d.getDate() + dir * viewDays)
      setAnchor(isoDate(d))
    }
  }

  const goToday = () => {
    setSelected(null)
    if (viewKey === '1w') {
      setAnchor(isoDate(startOfWeek(today)))
    } else if (viewKey === '1m') {
      const d = new Date(today); d.setDate(1)
      setAnchor(isoDate(d))
    } else {
      setAnchor(todayStr)
    }
  }

  // When switching view mode, re-anchor sensibly
  const switchView = (key) => {
    setViewKey(key)
    setSelected(null)
    if (key === '1w') setAnchor(isoDate(startOfWeek(today)))
    else if (key === '1m') { const d = new Date(today); d.setDate(1); setAnchor(isoDate(d)) }
    else setAnchor(todayStr)
  }

  // ── Build date cells for current view ────────────────────────────────────
  const cells = useMemo(() => {
    if (viewKey === '1m') {
      const d    = new Date(anchor + 'T12:00:00')
      const year = d.getFullYear(), month = d.getMonth()
      const firstDow   = new Date(year, month, 1).getDay()
      const daysInMonth = new Date(year, month + 1, 0).getDate()
      const result = []
      for (let i = 0; i < firstDow; i++) result.push(null)
      for (let day = 1; day <= daysInMonth; day++) {
        result.push(isoDate(new Date(year, month, day)))
      }
      while (result.length % 7 !== 0) result.push(null)
      return result
    } else {
      const result = []
      for (let i = 0; i < viewDays; i++) {
        result.push(isoDate(addDays(new Date(anchor + 'T12:00:00'), i)))
      }
      return result
    }
  }, [viewKey, anchor, viewDays])

  // ── Header label ─────────────────────────────────────────────────────────
  const headerLabel = useMemo(() => {
    if (viewKey === '1m') {
      const d = new Date(anchor + 'T12:00:00')
      return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    }
    const start = new Date(anchor + 'T12:00:00')
    const end   = addDays(start, viewDays - 1)
    if (viewKey === '1d') {
      return start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    }
    const s = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const e = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${s} – ${e}`
  }, [viewKey, anchor, viewDays])

  const selectedTasks = selected ? (dayTaskMap[selected] ?? []) : []
  const cols          = viewKey === '1m' ? 7 : viewDays

  return (
    <div style={{
      background: '#16161f', border: '1px solid #2a2a3e',
      borderRadius: 12, padding: 20, marginBottom: 28,
    }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => navigate(-1)} style={btnStyle}>‹</button>
        <span style={{ flex: 1, color: '#fff', fontWeight: 700, fontSize: 14, textAlign: 'center', minWidth: 160 }}>
          {headerLabel}
        </span>
        <button onClick={() => navigate(1)} style={btnStyle}>›</button>
        <button onClick={goToday} style={{ ...btnStyle, fontSize: 11, padding: '4px 10px' }}>Today</button>

        {/* view mode toggle */}
        <div style={{ display: 'flex', background: '#0f0f17', borderRadius: 6, padding: 2, gap: 1 }}>
          {VIEW_MODES.map(v => (
            <button key={v.key} onClick={() => switchView(v.key)} style={{
              border: 'none', borderRadius: 5, padding: '4px 10px', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: viewKey === v.key ? '#2a2a3e' : 'transparent',
              color:      viewKey === v.key ? '#fff'    : '#555',
            }}>{v.label}</button>
          ))}
        </div>
      </div>

      {/* day-of-week headers — month and week views */}
      {(viewKey === '1m' || viewKey === '1w') && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2, marginBottom: 4 }}>
          {DAYS_SHORT.map(d => (
            <div key={d} style={{ textAlign: 'center', color: '#555', fontSize: 11, fontWeight: 600 }}>{d}</div>
          ))}
        </div>
      )}

      {/* day cells grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 5 }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`e-${i}`} />

          const tasks     = dayTaskMap[dateStr] ?? []
          const isToday   = dateStr === todayStr
          const isSel     = dateStr === selected
          const d         = new Date(dateStr + 'T12:00:00')
          const dow       = d.getDay()
          const isWeekend = dow === 0 || dow === 6
          const dayNum    = d.getDate()

          // For multi-day views show weekday label above date
          const showDowLabel = viewKey === '3d' || viewKey === '1d'

          return (
            <div key={dateStr} onClick={() => setSelected(isSel ? null : dateStr)} style={{
              borderRadius: 7, padding: viewKey === '1d' ? '12px 10px' : '8px 6px',
              minHeight: viewKey === '1d' ? 140 : viewKey === '3d' ? 120 : viewKey === '1w' ? 100 : 80,
              cursor: tasks.length ? 'pointer' : 'default',
              background: isSel    ? '#2a2a3e'
                        : isToday  ? 'rgba(124,77,255,0.15)'
                        : isWeekend && viewKey === '1m' ? 'rgba(255,255,255,0.02)'
                        : 'transparent',
              border: isToday ? '1px solid #7c4dff' : '1px solid transparent',
              transition: 'background 0.15s',
            }}>
              {showDowLabel && (
                <div style={{ textAlign: 'center', color: '#555', fontSize: 10, marginBottom: 2 }}>
                  {DAYS_SHORT[dow]}
                </div>
              )}
              <div style={{
                textAlign: 'center', fontSize: viewKey === '1d' ? 22 : 13, fontWeight: isToday ? 700 : 400,
                color: isToday ? '#7c4dff' : isWeekend ? '#555' : '#aaa',
                marginBottom: 6,
              }}>{dayNum}</div>

              {/* task chips — all views show names, month caps at 3 then shows overflow */}
              {tasks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                  {(viewKey === '1m' ? tasks.slice(0, 3) : tasks).map(t => {
                    const c       = getCatColor(t._projectId) ?? STATUS_COLOR[t.status] ?? '#9E9E9E'
                    const isStart = t.start_date === dateStr
                    const isEnd   = t.end_date   === dateStr
                    return (
                      <div key={t.task_id}
                        onClick={e => { e.stopPropagation(); onTaskClick?.(t.task_id) }}
                        style={{
                        background: '#1e1e2e',
                        borderLeft: `3px solid ${c}`,
                        borderRadius: 4,
                        padding: viewKey === '1d' ? '5px 8px' : '3px 6px',
                        fontSize: viewKey === '1d' ? 12 : 11,
                        color: '#ccc',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.4,
                        cursor: 'pointer',
                      }}>
                        {(isStart || isEnd) && (
                          <span style={{ color: c, marginRight: 3, fontSize: 9 }}>
                            {isStart && isEnd ? '●' : isStart ? '▶' : '■'}
                          </span>
                        )}
                        {t.task_name}
                      </div>
                    )
                  })}
                  {viewKey === '1m' && tasks.length > 3 && (
                    <div style={{ fontSize: 10, color: '#555', paddingLeft: 4 }}>+{tasks.length - 3} more</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* selected day detail panel */}
      {selected && viewKey !== '1d' && (
        <div style={{ marginTop: 14, borderTop: '1px solid #2a2a3e', paddingTop: 12 }}>
          <div style={{ color: '#aaa', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {new Date(selected + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          {selectedTasks.length === 0 ? (
            <div style={{ color: '#555', fontSize: 12 }}>No tasks on this day.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {selectedTasks.map(t => {
                const c       = getCatColor(t._projectId) ?? STATUS_COLOR[t.status] ?? '#9E9E9E'
                const isStart = t.start_date === selected
                const isEnd   = t.end_date   === selected
                return (
                  <div key={t.task_id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: '#1e1e2e', borderRadius: 8, padding: '7px 10px',
                    borderLeft: `3px solid ${c}`,
                    cursor: 'pointer',
                  }} onClick={() => onTaskClick?.(t.task_id)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.task_name}
                      </div>
                      <div style={{ color: '#666', fontSize: 11 }}>{t._projectName}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {isStart && <span style={tagStyle}>starts</span>}
                      {isEnd   && <span style={tagStyle}>ends</span>}
                      <span style={{ fontSize: 10, color: STATUS_COLOR[t.status], fontWeight: 600 }}>{t.status}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const btnStyle = {
  background: '#2a2a3e', border: 'none', borderRadius: 6,
  color: '#fff', padding: '5px 12px', cursor: 'pointer', fontSize: 16, fontWeight: 700,
}

const tagStyle = {
  fontSize: 10, background: '#2a2a3e', color: '#aaa', borderRadius: 4, padding: '1px 5px',
}
