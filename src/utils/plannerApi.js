// The guided planner runs on Lance's PC (planner/runner.mjs) and drives headless Claude Code on his
// Claude subscription. The board only talks to it over localhost; Google Drive stays in the browser.
export const PLANNER_URL = 'http://127.0.0.1:43128'

async function call(path, options = {}) {
  let response
  try {
    response = await fetch(`${PLANNER_URL}${path}`, { cache: 'no-store', ...options })
  } catch {
    const e = new Error('The planner is not running on this computer.')
    e.offline = true
    throw e
  }
  const type = response.headers.get('content-type') || ''
  const body = type.includes('application/json') ? await response.json().catch(() => ({})) : await response.text()
  if (!response.ok) {
    const e = new Error((body && body.error) || `The planner returned ${response.status}`)
    e.status = response.status
    throw e
  }
  return body
}

const post = (path, value) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value ?? {}) })

export const plannerStatus  = (fresh = false) => call(`/status${fresh ? '?fresh=1' : ''}`)
export const listGuided     = () => call('/projects')
export const startGuided    = (name, idea) => post('/projects', { name, idea })
export const getGuided      = (slug, since = 0) => call(`/projects/${slug}?since=${since}`)
export const replyGuided    = (slug, answer) => post(`/projects/${slug}/reply`, answer)
export const retryGuided    = slug => post(`/projects/${slug}/retry`)
export const stopGuided     = slug => post(`/projects/${slug}/stop`)
export const fetchGateFile  = (slug, file) => call(`/projects/${slug}/gate?file=${encodeURIComponent(file)}`)

// After a gate review is saved to Drive, hand it to the planner when this plan is a guided one.
// Best effort: returns { sent, started } or null when there is no planner or no such session.
export async function handBackReview(planId, level, revision, review) {
  try {
    const { projects } = await listGuided()
    const p = projects.find(x => x.plan_id === planId)
    if (!p) return null
    const r = await post(`/projects/${p.slug}/review`, { level, revision, review })
    return { sent: true, started: Boolean(r.started), slug: p.slug }
  } catch (e) {
    if (e.offline) return null
    return { sent: false, error: e.message }
  }
}
