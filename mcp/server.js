import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import Papa from 'papaparse'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { getGoogleSession, closeSessionBridge } from './sessionBridge.js'
import { loadCSV, saveCSV, loadHistory, restoreRevision, setToken, loadCouncil, saveCouncil } from '../src/utils/driveApi.js'
import { csvColumns } from '../src/utils/csvColumns.js'
import { parseCouncil, mergePayload, currentRevision, levelToBoardRows, plansList, LEVEL_NAMES } from '../src/utils/councilPlans.js'

const STATUSES = ['not_started', 'in_progress', 'at_risk', 'overdue', 'complete']
const TYPES = ['task', 'milestone']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function requireSession() {
  const session = getGoogleSession()
  if (!session) throw new Error('Board access is not connected. Open The Operators PM Board → Settings → AI Connector → Connect this session.')
  setToken(session.accessToken)
  return session
}

async function readRows() {
  requireSession()
  const csv = await loadCSV()
  if (!csv) return []
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true })
  if (parsed.errors.length) throw new Error(`Could not parse the board CSV: ${parsed.errors[0].message}`)
  return parsed.data
}

async function writeRows(rows) {
  requireSession()
  // Every row's keys, not just the first row's, so fields like notes are never dropped.
  await saveCSV(Papa.unparse(rows, { columns: csvColumns(rows) }))
}

async function readCouncil() {
  requireSession()
  return parseCouncil(await loadCouncil())
}

async function writeCouncil(data) {
  requireSession()
  await saveCouncil(JSON.stringify(data, null, 1))
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(error) {
  return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
}

function toolHandler(action) {
  return async (...args) => {
    try { return await action(...args) }
    catch (error) { return errorResult(error) }
  }
}

function parseDependencies(value) {
  return (value ?? '').split(',').map(id => id.trim()).filter(Boolean)
}

function checkTasks(tasks) {
  for (const task of tasks) {
    for (const date of [task.start_date, task.end_date]) {
      if (date && (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
        throw new Error(`Task “${task.task_name}” has an invalid date. Use YYYY-MM-DD.`)
      }
    }
    if (task.file_link) {
      let url
      try { url = new URL(task.file_link) } catch { throw new Error(`Task “${task.task_name}” has an invalid file link.`) }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('File links must use HTTP or HTTPS.')
    }
  }
  const byId = new Map(tasks.map(task => [task.task_id, task]))
  for (const task of tasks) {
    for (const dependency of parseDependencies(task.dependencies)) {
      if (!byId.has(dependency)) throw new Error(`Task “${task.task_name}” depends on missing task ${dependency}.`)
      if (dependency === task.task_id) throw new Error(`Task “${task.task_name}” cannot depend on itself.`)
    }
  }
  const visiting = new Set()
  const visited = new Set()
  const visit = id => {
    if (visiting.has(id)) throw new Error('These dependencies would create a cycle. Change the links and try again.')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of parseDependencies(byId.get(id).dependencies)) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.task_id)
}

function uniqueTaskId(projectId, rows, requestedId) {
  if (requestedId) {
    if (rows.some(row => row.task_id === requestedId)) throw new Error(`Task ID ${requestedId} already exists.`)
    return requestedId
  }
  let id
  do { id = `${projectId}_ai_${randomUUID().slice(0, 8)}` }
  while (rows.some(row => row.task_id === id))
  return id
}

function normalizeTask(projectId, projectName, task, allRows, index) {
  const taskId = uniqueTaskId(projectId, allRows, task.task_id)
  const status = task.status ?? 'not_started'
  const type = task.type ?? 'task'
  const progress = task.progress ?? 0
  if (!STATUSES.includes(status)) throw new Error(`Unsupported task status: ${status}`)
  if (!TYPES.includes(type)) throw new Error(`Unsupported task type: ${type}`)
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error('Progress must be a whole number between 0 and 100.')
  for (const date of [task.start_date, task.end_date]) {
    if (date && (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
      throw new Error(`Invalid date ${date}; use YYYY-MM-DD.`)
    }
  }
  const dependencies = task.dependencies ?? ''
  if (Array.isArray(dependencies)) throw new Error('Dependencies must be provided as a comma-separated string of task IDs.')
  const dateMode = task.date_mode ?? 'fixed'
  if (!['fixed', 'dynamic'].includes(dateMode)) throw new Error('Scheduling mode must be fixed or dynamic.')
  const duration = task.duration_days == null ? '' : String(task.duration_days)
  if (duration && (!Number.isInteger(Number(duration)) || Number(duration) < 1)) throw new Error('Duration must be a positive whole number of days.')
  const fileLink = task.file_link ?? ''
  if (fileLink) {
    let url
    try { url = new URL(fileLink) } catch { throw new Error('File links must be complete HTTP or HTTPS URLs.') }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('File links must use HTTP or HTTPS.')
  }
  return {
    project_id: projectId,
    project_name: projectName,
    task_id: taskId,
    task_name: task.task_name.trim(),
    start_date: task.start_date ?? '',
    end_date: task.end_date ?? '',
    progress: String(progress),
    dependencies,
    assignee: task.assignee ?? '',
    status,
    type,
    x: String(100 + (index % 4) * 250),
    y: String(100 + Math.floor(index / 4) * 120),
    date_mode: dateMode,
    duration_days: duration,
    file_link: fileLink,
    notes: task.notes ?? '',
  }
}

const taskSchema = z.object({
  task_id: z.string().trim().min(1).max(100).optional(),
  task_name: z.string().trim().min(1).max(240),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  dependencies: z.string().max(4000).optional(),
  assignee: z.string().max(200).optional(),
  status: z.enum(STATUSES).optional(),
  type: z.enum(TYPES).optional(),
  date_mode: z.enum(['fixed', 'dynamic']).optional(),
  duration_days: z.number().int().positive().optional(),
  file_link: z.string().max(2000).optional(),
  notes: z.string().max(10000).optional(),
}).strict()

const updateSchema = z.object({
  task_name: z.string().trim().min(1).max(240),
  start_date: z.string(),
  end_date: z.string(),
  progress: z.number().int().min(0).max(100),
  dependencies: z.string().max(4000),
  assignee: z.string().max(200),
  status: z.enum(STATUSES),
  type: z.enum(TYPES),
  date_mode: z.enum(['fixed', 'dynamic']),
  duration_days: z.union([z.number().int().positive(), z.literal('')]),
  file_link: z.string().max(2000),
  notes: z.string().max(10000),
}).partial().strict()

function createServer() {
  const server = new McpServer({ name: 'operators-pm-board', version: '1.0.0' })

  server.registerTool('list_projects', {
    description: 'List projects in the connected Operators PM Board, including task counts and status counts.',
    inputSchema: {},
  }, toolHandler(async () => {
    const rows = await readRows()
    const projects = new Map()
    for (const row of rows) {
      if (!projects.has(row.project_id)) projects.set(row.project_id, { project_id: row.project_id, project_name: row.project_name, task_count: 0, statuses: {} })
      const project = projects.get(row.project_id)
      project.task_count += 1
      project.statuses[row.status] = (project.statuses[row.status] ?? 0) + 1
    }
    return textResult([...projects.values()])
  }))

  server.registerTool('get_project_tasks', {
    description: 'Get every task, dependency, schedule, note, assignee, and link for one project.',
    inputSchema: { project_id: z.string().min(1) },
  }, toolHandler(async ({ project_id }) => {
    const rows = await readRows()
    const tasks = rows.filter(row => row.project_id === project_id)
    if (!tasks.length) throw new Error(`No tasks found for project ${project_id}.`)
    return textResult(tasks)
  }))

  server.registerTool('create_project', {
    description: 'Create a new project in the board. This writes a first placeholder task; use add_tasks_to_project to structure the plan.',
    inputSchema: { project_name: z.string().trim().min(1).max(160) },
  }, toolHandler(async ({ project_name }) => {
    const rows = await readRows()
    if (rows.some(row => row.project_name?.toLowerCase() === project_name.toLowerCase())) {
      throw new Error(`A project named “${project_name}” already exists.`)
    }
    const slug = project_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'project'
    let project_id = `proj_${slug}_${randomUUID().slice(0, 6)}`
    while (rows.some(row => row.project_id === project_id)) project_id = `proj_${slug}_${randomUUID().slice(0, 6)}`
    const firstTask = normalizeTask(project_id, project_name, { task_name: 'Project kickoff' }, rows, 0)
    const next = [...rows, firstTask]
    checkTasks(next.filter(row => row.project_id === project_id))
    await writeRows(next)
    return textResult({ project_id, project_name, first_task_id: firstTask.task_id })
  }))

  server.registerTool('add_tasks_to_project', {
    description: 'Add one or more tasks or milestones to an existing project. Task IDs can be supplied so new tasks can depend on each other; dependencies must reference task IDs in this project. This change is saved to Drive and enters the seven-day history.',
    inputSchema: {
      project_id: z.string().min(1),
      tasks: z.array(taskSchema).min(1).max(100),
    },
  }, toolHandler(async ({ project_id, tasks }) => {
    const rows = await readRows()
    const projectRows = rows.filter(row => row.project_id === project_id)
    if (!projectRows.length) throw new Error(`No project found for ${project_id}.`)
    const projectName = projectRows[0].project_name
    const added = tasks.map((task, index) => normalizeTask(project_id, projectName, task, rows, rows.length + index))
    // Validate IDs across the whole batch and verify all links before persisting.
    const combined = [...rows, ...added]
    const ids = combined.map(row => row.task_id)
    if (new Set(ids).size !== ids.length) throw new Error('The proposed tasks contain duplicate task IDs.')
    checkTasks(combined.filter(row => row.project_id === project_id))
    await writeRows(combined)
    return textResult({ added_count: added.length, tasks: added })
  }))

  server.registerTool('update_task', {
    description: 'Update fields on an existing task. Dependencies are comma-separated task IDs. The update is validated against dependency cycles and saved to Drive history.',
    inputSchema: {
      project_id: z.string().min(1),
      task_id: z.string().min(1),
      changes: updateSchema,
    },
  }, toolHandler(async ({ project_id, task_id, changes }) => {
    if (!Object.keys(changes).length) throw new Error('Provide at least one task field to change.')
    const rows = await readRows()
    const index = rows.findIndex(row => row.project_id === project_id && row.task_id === task_id)
    if (index < 0) throw new Error(`Task ${task_id} was not found in project ${project_id}.`)
    const next = rows.map((row, rowIndex) => rowIndex === index
      ? { ...row, ...Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, String(value)])) }
      : row)
    checkTasks(next.filter(row => row.project_id === project_id))
    await writeRows(next)
    return textResult(next[index])
  }))

  server.registerTool('list_board_versions', {
    description: 'List project data and settings versions from the last seven days that can be restored.',
    inputSchema: {},
  }, toolHandler(async () => {
    requireSession()
    const history = await loadHistory()
    return textResult(Object.fromEntries(Object.entries(history).map(([kind, revisions]) => [
      kind,
      revisions.map(revision => ({ revision_id: revision.id, modifiedTime: revision.modifiedTime, modifiedBy: revision.lastModifyingUser?.displayName })),
    ])))
  }))

  server.registerTool('restore_board_version', {
    description: 'Restore a recent project-data or settings version. This changes the board but creates a new Drive revision, so the current state remains recoverable.',
    inputSchema: {
      kind: z.enum(['projects', 'settings']),
      revision_id: z.string().min(1),
    },
  }, toolHandler(async ({ kind, revision_id }) => {
    requireSession()
    const history = await loadHistory()
    const revision = history[kind].find(item => item.id === revision_id)
    if (!revision) throw new Error('That version is not available in the seven-day rollback window.')
    await restoreRevision({ fileId: revision.fileId, revisionId: revision.id, kind })
    return textResult({ restored: true, kind, modifiedTime: revision.modifiedTime })
  }))

  // ── Project Council plan reviews (council-plans.json beside projects.csv) ──────────────
  server.registerTool('council_list_plans', {
    description: 'List Project Council plans under review on the board, with each level (L0 outline .. L4 steps), its status (in_review, changes_requested, approved), current revision and flag counts.',
    inputSchema: {},
  }, toolHandler(async () => {
    const data = await readCouncil()
    return textResult(plansList(data).map(plan => ({
      plan_id: plan.plan_id, name: plan.name, updated_at: plan.updated_at,
      levels: Object.fromEntries(Object.entries(plan.levels ?? {}).map(([n, level]) => {
        const rev = currentRevision(level)
        return [n, { name: LEVEL_NAMES[Number(n)], status: level.status, revision: level.current_revision,
          items: rev?.payload?.items?.length ?? 0, flags: rev?.payload?.counts ?? {}, decided: rev?.review?.decision ?? null }]
      })),
    })))
  }))

  server.registerTool('council_publish_level', {
    description: 'Publish one level of a Project Council plan for review on the board. Pass gate_file, the absolute path of the gate file written by gate_publish.py (plan/gates/L<n>-r<k>.json); payload_json is accepted for small levels. The level is marked "ready for review"; earlier revisions and their reviews are kept.',
    inputSchema: {
      gate_file: z.string().min(1).max(1000).optional(),
      payload_json: z.string().min(2).max(2000000).optional(),
    },
  }, toolHandler(async ({ gate_file, payload_json }) => {
    if (!gate_file && !payload_json) throw new Error('Pass gate_file (preferred) or payload_json.')
    let text = payload_json
    if (gate_file) {
      if (!/^L[0-4]-r\d+\.json$/.test(basename(gate_file))) throw new Error('gate_file must be a council gate file named L<n>-r<k>.json.')
      text = await readFile(gate_file, 'utf8')
    }
    let payload
    try { payload = JSON.parse(text) } catch { throw new Error('The gate file is not valid JSON.') }
    const data = await readCouncil()
    const next = mergePayload(data, payload)
    await writeCouncil(next)
    return textResult({ published: true, plan_id: payload.plan_id, level: payload.level, revision: payload.revision, items: payload.items.length })
  }))

  server.registerTool('council_get_review', {
    description: "Read Lance's review of one level of a Project Council plan: the level status, the revision reviewed, and the review (decision approved or changes_requested, or null if not finished; overall comment; per-item marks approve, change or question with comments; change-request decisions). With save_to (an absolute path ending in -review.json) the review is also written there for gate_apply.py --review.",
    inputSchema: { plan_id: z.string().min(1), level: z.number().int().min(0).max(4), save_to: z.string().max(1000).optional() },
  }, toolHandler(async ({ plan_id, level, save_to }) => {
    const data = await readCouncil()
    const lv = data.plans?.[plan_id]?.levels?.[String(level)]
    if (!lv) throw new Error(`Plan ${plan_id} has no level ${level} on the board.`)
    const rev = currentRevision(lv)
    const review = rev?.review ?? null
    if (save_to) {
      if (!/-review\.json$/.test(save_to)) throw new Error('save_to must end in -review.json.')
      if (!review) throw new Error('Lance has not saved a review of this level yet.')
      await writeFile(save_to, JSON.stringify(review, null, 1), 'utf8')
    }
    return textResult({ plan_id, level, status: lv.status, revision: lv.current_revision, review, saved_to: save_to ?? null })
  }))

  server.registerTool('council_promote_level', {
    description: "Put an approved level of a Project Council plan onto the board as a live project for one scenario (bootstrap, value or funded), using the dated items. Re-running it updates dates and names but keeps each task's status and progress.",
    inputSchema: { plan_id: z.string().min(1), level: z.number().int().min(2).max(4), scenario: z.string().min(1) },
  }, toolHandler(async ({ plan_id, level, scenario }) => {
    const data = await readCouncil()
    const plan = data.plans?.[plan_id]
    if (!plan) throw new Error(`Plan ${plan_id} is not on the board.`)
    if (plan.levels?.[String(level)]?.status !== 'approved') throw new Error(`Level ${level} is not approved yet.`)
    const projectId = `proj_council_${plan_id}_${scenario}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
    const projectName = `${plan.name} (${scenario})`
    const rows = await readRows()
    const fresh = levelToBoardRows(plan, level, scenario, projectId, projectName)
    if (!fresh.length) throw new Error(`No dated ${scenario} items in level ${level}.`)
    const prior = Object.fromEntries(rows.filter(r => r.project_id === projectId).map(r => [r.task_id, r]))
    const merged = fresh.map(r => prior[r.task_id] ? { ...r, status: prior[r.task_id].status, progress: prior[r.task_id].progress, x: prior[r.task_id].x, y: prior[r.task_id].y } : r)
    const next = [...rows.filter(r => r.project_id !== projectId), ...merged]
    checkTasks(next.filter(r => r.project_id === projectId))
    await writeRows(next)
    return textResult({ project_id: projectId, project_name: projectName, tasks: merged.length })
  }))

  return server
}

const bridgeHandle = serveStdio(createServer)
console.error('Operators PM Board MCP server connected over stdio.')
let shutdownStarted = false
const shutdown = () => {
  if (shutdownStarted) return
  shutdownStarted = true
  void bridgeHandle.close().finally(closeSessionBridge)
}
process.stdin.on('end', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
