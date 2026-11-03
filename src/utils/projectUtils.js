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

// Arrange tasks on a date-based x axis and place dependent work around the
// vertical center of its prerequisites. Nodes with overlapping time columns
// are separated vertically while retaining the dependency-driven layout.
export function formatGraphNodes(nodes, edges) {
  if (!nodes.length) return nodes

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const parents = new Map(nodes.map(node => [node.id, []]))
  const children = new Map(nodes.map(node => [node.id, []]))
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue
    parents.get(edge.target).push(edge.source)
    children.get(edge.source).push(edge.target)
  }

  const dateFor = node => {
    const date = node.data.type === 'milestone'
      ? node.data.end_date || node.data.start_date
      : node.data.start_date || node.data.end_date
    const time = date ? Date.parse(`${date}T00:00:00`) : NaN
    return Number.isFinite(time) ? time : Infinity
  }
  const byDate = (a, b) => dateFor(a) - dateFor(b) || a.id.localeCompare(b.id)

  const chronologicalDates = [...new Set(nodes.map(dateFor).filter(Number.isFinite))].sort((a, b) => a - b)
  const dateColumn = new Map(chronologicalDates.map((date, index) => [date, index]))
  const unplacedColumn = chronologicalDates.length
  const xFor = node => 48 + (dateColumn.get(dateFor(node)) ?? unplacedColumn) * 258

  // Find weakly connected dependency groups so unrelated work gets its own
  // compact vertical band. Within each group, roots are ordered by date.
  const visited = new Set()
  const components = []
  for (const start of [...nodes].sort(byDate)) {
    if (visited.has(start.id)) continue
    const component = []
    const stack = [start.id]
    visited.add(start.id)
    while (stack.length) {
      const id = stack.pop()
      component.push(nodeById.get(id))
      for (const nextId of [...parents.get(id), ...children.get(id)]) {
        if (!visited.has(nextId)) { visited.add(nextId); stack.push(nextId) }
      }
    }
    components.push(component.sort(byDate))
  }
  components.sort((a, b) => byDate(a[0], b[0]))

  const desiredY = new Map()
  const topoOrder = []
  const indegree = new Map(nodes.map(node => [node.id, parents.get(node.id).length]))
  const ready = nodes.filter(node => indegree.get(node.id) === 0).sort(byDate)
  while (ready.length) {
    const node = ready.shift()
    topoOrder.push(node.id)
    for (const childId of children.get(node.id)) {
      indegree.set(childId, indegree.get(childId) - 1)
      if (indegree.get(childId) === 0) {
        ready.push(nodeById.get(childId))
        ready.sort(byDate)
      }
    }
  }

  let nextBandY = 48
  for (const component of components) {
    const componentIds = new Set(component.map(node => node.id))
    const roots = component.filter(node => parents.get(node.id).every(id => !componentIds.has(id)) || parents.get(node.id).length === 0)
    const sortedRoots = roots.sort(byDate)
    sortedRoots.forEach((root, index) => desiredY.set(root.id, nextBandY + index * 148))

    for (const id of topoOrder) {
      if (!componentIds.has(id) || desiredY.has(id)) continue
      const parentYs = parents.get(id).map(parentId => desiredY.get(parentId)).filter(Number.isFinite)
      if (parentYs.length) desiredY.set(id, parentYs.reduce((sum, y) => sum + y, 0) / parentYs.length)
    }

    // Cyclic or otherwise unresolved nodes get a deterministic position.
    for (const node of component) {
      if (!desiredY.has(node.id)) {
        const parentYs = parents.get(node.id).map(parentId => desiredY.get(parentId)).filter(Number.isFinite)
        desiredY.set(node.id, parentYs.length
          ? parentYs.reduce((sum, y) => sum + y, 0) / parentYs.length
          : nextBandY)
      }
    }
    const maxY = Math.max(...component.map(node => desiredY.get(node.id)))
    nextBandY = maxY + 178
  }

  const placed = []
  const ordered = [...nodes].sort((a, b) =>
    xFor(a) - xFor(b) || desiredY.get(a.id) - desiredY.get(b.id) || a.id.localeCompare(b.id))
  const nodeWidth = node => node.type === 'milestone' ? 100 : 220
  const nodeHeight = node => node.type === 'milestone' ? 100 : 112
  const hasCollision = (node, centerY) => placed.some(other => {
    const overlapsX = Math.abs(xFor(node) - other.x) < (nodeWidth(node) + other.width) / 2 + 28
    const overlapsY = Math.abs(centerY - other.centerY) < (nodeHeight(node) + other.height) / 2 + 24
    return overlapsX && overlapsY
  })

  return ordered.map(node => {
    const desired = desiredY.get(node.id)
    const candidates = [0]
    for (let step = 1; step <= nodes.length; step += 1) candidates.push(step * 132, -step * 132)
    const offset = candidates.find(value => !hasCollision(node, desired + value)) ?? 0
    const centerY = desired + offset
    placed.push({ x: xFor(node), centerY, width: nodeWidth(node), height: nodeHeight(node) })
    return {
      ...node,
      position: { x: xFor(node), y: Math.round(centerY - nodeHeight(node) / 2) },
    }
  })
}
