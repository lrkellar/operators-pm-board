import Papa from 'papaparse'
// Plan reviews from Project Council.
//
// council-plans.json (in the OperatorsPMBoard Drive folder, next to projects.csv) holds plans that
// are being built level by level (L0 outline .. L4 steps) and reviewed on this board before any of
// them becomes a live project:
//
// { schema_version: 1,
//   plans: { <plan_id>: { plan_id, name, scenarios, updated_at,
//     levels: { "<n>": { status, current_revision, level_name, gate_question,
//       revisions: [{ revision, published_at, payload, review }] } } } } }
//
// payload  = what the council published for that revision (items, parents, flags, totals...)
// review   = { decision: null|'approved'|'changes_requested', comment, decided_at, saved_at,
//              marks: { <item id>: { mark: 'approve'|'change'|'question', comment, at } },
//              cr_decisions: { <CR id>: 'approve'|'reject' } }
// Shared by the web app and the local MCP connector. No React or DOM here.

export const COUNCIL_FILENAME = 'council-plans.json'
export const LEVEL_NAMES = ['Outline', 'Strategy', 'Execution plan', 'Activities', 'Steps']
export const LEVEL_STATUS = {
  drafting:          { label: 'Drafting',          color: '#9E9E9E' },
  in_review:         { label: 'Ready for review',  color: '#2196F3' },
  changes_requested: { label: 'Sent back',         color: '#FF9800' },
  approved:          { label: 'Approved',          color: '#4CAF50' },
}
export const MARKS = {
  approve:  { label: 'Approve',  color: '#4CAF50' },
  change:   { label: 'Change',   color: '#F44336' },
  question: { label: 'Question', color: '#FF9800' },
}
const KEEP_PAYLOADS = 3

export function emptyCouncil() {
  return { schema_version: 1, plans: {} }
}

export function parseCouncil(text) {
  if (!text) return emptyCouncil()
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || typeof data.plans !== 'object') return emptyCouncil()
    return data
  } catch {
    return emptyCouncil()
  }
}

export function validatePayload(payload) {
  const need = ['plan_id', 'level', 'revision', 'items', 'scenarios']
  for (const key of need) {
    if (payload?.[key] === undefined) throw new Error(`The gate file is missing "${key}". Publish it with gate_publish.py.`)
  }
  if (!Number.isInteger(payload.level) || payload.level < 0 || payload.level > 4) throw new Error('Level must be 0 to 4.')
  if (!Array.isArray(payload.items)) throw new Error('The gate file has no item list.')
}

// Add one published level revision to the council data (returns a new object).
export function mergePayload(data, payload) {
  validatePayload(payload)
  const next = structuredClone(data ?? emptyCouncil())
  const plans = next.plans ?? (next.plans = {})
  const plan = plans[payload.plan_id] ?? (plans[payload.plan_id] = { plan_id: payload.plan_id, levels: {} })
  plan.name = payload.plan_name ?? plan.name ?? payload.plan_id
  plan.scenarios = payload.scenarios
  plan.updated_at = payload.published_at ?? new Date().toISOString()
  const key = String(payload.level)
  const level = plan.levels[key] ?? (plan.levels[key] = { revisions: [] })
  level.status = 'in_review'
  level.current_revision = payload.revision
  level.level_name = payload.level_name ?? LEVEL_NAMES[payload.level]
  level.gate_question = payload.gate_question ?? ''
  level.revisions = level.revisions.filter(r => r.revision !== payload.revision)
  level.revisions.push({ revision: payload.revision, published_at: plan.updated_at, payload, review: null })
  level.revisions.sort((a, b) => a.revision - b.revision)
  level.revisions.slice(0, -KEEP_PAYLOADS).forEach(r => { r.payload = null })
  return next
}

// Write one review into the council data (returns a new object).
export function setReview(data, planId, levelNo, revision, review, status) {
  const next = structuredClone(data)
  const level = next.plans?.[planId]?.levels?.[String(levelNo)]
  if (!level) throw new Error(`No level ${levelNo} for plan ${planId}.`)
  const rev = level.revisions.find(r => r.revision === revision)
  if (!rev) throw new Error(`Revision ${revision} of level ${levelNo} is not on the board.`)
  if (level.current_revision !== revision) throw new Error('A newer revision of this level has been published. Reload before reviewing.')
  rev.review = { ...review, saved_at: new Date().toISOString() }
  if (status) level.status = status
  next.plans[planId].updated_at = rev.review.saved_at
  return next
}

export function currentRevision(level) {
  if (!level) return null
  return level.revisions?.find(r => r.revision === level.current_revision) ?? null
}

export function plansList(data) {
  return Object.values(data?.plans ?? {}).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
}

export function waitingCount(data) {
  return plansList(data).reduce((n, p) => n + Object.values(p.levels ?? {}).filter(l => l.status === 'in_review').length, 0)
}

// Rows for the live board (projects.csv) from an approved level, for one scenario.
export function levelToBoardRows(plan, levelNo, scenario, projectId, projectName) {
  const rev = currentRevision(plan.levels?.[String(levelNo)])
  if (!rev?.payload) throw new Error('That level has no published content.')
  const safe = id => `${projectId}_${String(id).replace(/[^A-Za-z0-9]+/g, '_')}`
  const items = rev.payload.items.filter(i => (i.scenarios ?? []).includes(scenario) && i.dates?.[scenario])
  const ids = new Set(items.map(i => i.id))
  return items.map((item, index) => ({
    project_id: projectId,
    project_name: projectName,
    task_id: safe(item.id),
    task_name: `${item.id} ${item.title}`.slice(0, 240),
    start_date: item.dates[scenario].start,
    end_date: item.dates[scenario].finish,
    progress: '0',
    dependencies: (item.predecessors ?? []).filter(p => ids.has(p)).map(safe).join(','),
    assignee: item.owner_seat ?? '',
    status: 'not_started',
    type: item.kind === 'milestone' && levelNo === 4 ? 'milestone' : 'task',
    x: String(100 + (index % 4) * 250),
    y: String(100 + Math.floor(index / 4) * 120),
    date_mode: 'fixed',
    duration_days: '',
    file_link: '',
    notes: [item.summary, `From Project Council plan ${plan.plan_id}, L${levelNo} ${LEVEL_NAMES[levelNo]}, ${scenario}.`].filter(Boolean).join(' '),
  }))
}

// ── Finished plans (out/plan-<scenario>.csv) onto the live projects page ─────────────────────────
// The council's export has one row per WBS element. The board gets the deepest rows of each branch
// (steps where the current stage is detailed, coarser items beyond it), with dates as YYYY-MM-DD and
// dependencies as board task ids.
export const councilProjectId = (planId, scenario) => `proj_council_${planId}_${scenario}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase()

export function councilCsvToBoardRows(csvText, { planId, planName, scenario }) {
  const { data } = Papa.parse(String(csvText).replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
  const rows = data.filter(r => r['Task ID'])
  const wbs = rows.map(r => String(r.WBS ?? ''))
  const hasChildren = w => w && wbs.some(o => o !== w && o.startsWith(`${w}.`))
  const leaves = rows.filter(r => !hasChildren(String(r.WBS ?? '')))
  const projectId = councilProjectId(planId, scenario)
  const safe = id => `${projectId}_${String(id).replace(/[^A-Za-z0-9]+/g, '_')}`
  const ids = new Set(leaves.map(r => r['Task ID']))
  const day = v => String(v ?? '').slice(0, 10)
  const deps = v => String(v ?? '').split(/[;,]\s*/).map(x => x.trim().replace(/(FS|SS|FF|SF)([+-].*)?$/i, ''))
    .filter(x => ids.has(x)).map(safe).join(',')
  const phases = [...new Set(leaves.map(r => r.Phase))]
  const placed = {}
  return leaves.filter(r => day(r.Start) && day(r.Finish)).map(r => {
    const col = phases.indexOf(r.Phase)
    const row = (placed[col] = (placed[col] ?? -1) + 1)
    const notes = [
      r.Notes,
      r.Deliverable && `Deliverable: ${r.Deliverable}`,
      r['Done When'] && `Done when: ${r['Done When']}`,
      r['Effort (min)'] && `Effort: ${Math.round(Number(r['Effort (min)']) / 6) / 10} h`,
      Number(r['Cost (USD)']) ? `Cost: $${r['Cost (USD)']}` : '',
      `From Project Council plan ${planId} (${scenario}), ${r['Work Package'] || r.Phase}.`,
    ].filter(Boolean).map(x => x.trim()).join(' · ')
    return {
      project_id: projectId,
      project_name: `${planName} (${scenario})`,
      task_id: safe(r['Task ID']),
      task_name: `${r['Task ID']} ${r['Task Name']}`.slice(0, 240),
      start_date: day(r.Start),
      end_date: day(r.Finish),
      progress: '0',
      dependencies: deps(r.Predecessors),
      assignee: r.Resource || r['Owner Role'] || '',
      status: 'not_started',
      type: r.Milestone === 'Y' || /milestone/i.test(r.Type) && !/summary/i.test(r.Type) ? 'milestone' : 'task',
      x: String(100 + col * 280),
      y: String(100 + row * 110),
      date_mode: 'fixed',
      duration_days: '',
      file_link: '',
      notes,
    }
  })
}
