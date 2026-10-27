export const STATUS_COLOR = {
  complete:    '#4CAF50',
  in_progress: '#2196F3',
  at_risk:     '#FF9800',
  overdue:     '#F44336',
  not_started: '#9E9E9E',
}

export const STATUS_LABEL = {
  complete:    '✅ Complete',
  in_progress: '🔵 In Progress',
  at_risk:     '🟠 At Risk',
  overdue:     '🔴 Overdue',
  not_started: '⚪ Not Started',
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const PRIORITY = ['overdue', 'at_risk', 'in_progress', 'not_started', 'complete']

export function getProjects(rows) {
  const map = {}
  rows.forEach(r => {
    if (!map[r.project_id]) map[r.project_id] = { id: r.project_id, name: r.project_name, tasks: [] }
    map[r.project_id].tasks.push(r)
  })
  return Object.values(map)
}

export function pressingTask(tasks) {
  const active = tasks.filter(t => t.status !== 'complete')
  if (!active.length) return null
  return active.sort((a, b) => {
    const pa = PRIORITY.indexOf(a.status)
    const pb = PRIORITY.indexOf(b.status)
    if (pa !== pb) return pa - pb
    return new Date(a.end_date) - new Date(b.end_date)
  })[0]
}

export function projectHealth(tasks) {
  const statuses = tasks.map(t => t.status)
  if (statuses.includes('overdue'))     return 'overdue'
  if (statuses.includes('at_risk'))     return 'at_risk'
  if (statuses.includes('in_progress')) return 'in_progress'
  if (statuses.every(s => s === 'complete')) return 'complete'
  return 'not_started'
}

// ── Date resolution ───────────────────────────────────────────────────────────
// For dynamic tasks: walk dependencies in topological order and compute
// effective start/end dates. Returns a map of task_id -> { start_date, end_date }
export function resolveDates(tasks) {
  const byId = Object.fromEntries(tasks.map(t => [t.task_id, t]))
  const resolved = {}

  const resolve = (id, visited = new Set()) => {
    if (resolved[id]) return resolved[id]
    if (visited.has(id)) return null  // cycle guard
    visited.add(id)

    const t = byId[id]
    if (!t) return null

    if (t.date_mode !== 'dynamic') {
      resolved[id] = { start_date: t.start_date, end_date: t.end_date }
      return resolved[id]
    }

    // dynamic: find latest end date among all dependencies
    const deps = t.dependencies ? t.dependencies.split(',').map(s => s.trim()).filter(Boolean) : []
    let latestEnd = null
    for (const depId of deps) {
      const depResolved = resolve(depId, new Set(visited))
      if (depResolved?.end_date) {
        const d = new Date(depResolved.end_date)
        if (!latestEnd || d > latestEnd) latestEnd = d
      }
    }

    const startDate = latestEnd ? new Date(latestEnd.getTime() + 86400000) : new Date()
    const duration  = Math.max(parseInt(t.duration_days) || 1, 1)
    const endDate   = new Date(startDate.getTime() + (duration - 1) * 86400000)

    resolved[id] = {
      start_date: startDate.toISOString().slice(0, 10),
      end_date:   endDate.toISOString().slice(0, 10),
    }
    return resolved[id]
  }

  tasks.forEach(t => resolve(t.task_id))
  return resolved
}

// Returns tasks with effective dates merged in (for rendering)
export function tasksWithResolvedDates(tasks) {
  const dateMap = resolveDates(tasks)
  return tasks.map(t => ({
    ...t,
    ...(dateMap[t.task_id] ?? {}),
  }))
}

export function rowsToNodes(tasks) {
  return tasks.map(t => ({
    id: t.task_id,
    type: t.type === 'milestone' ? 'milestone' : 'taskNode',
    position: { x: parseFloat(t.x) || 100, y: parseFloat(t.y) || 100 },
    data: { ...t },
  }))
}

export function rowsToEdges(tasks) {
  const edges = []
  tasks.forEach(t => {
    if (!t.dependencies) return
    t.dependencies.split(',').map(s => s.trim()).filter(Boolean).forEach(srcId => {
      edges.push({
        id: `e-${srcId}-${t.task_id}`,
        source: srcId,
        target: t.task_id,
        animated: t.status === 'in_progress',
        style: { stroke: STATUS_COLOR[t.status] ?? '#9E9E9E' },
        markerEnd: { type: 'arrowclosed' },
      })
    })
  })
  return edges
}
