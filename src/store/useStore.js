import { create } from 'zustand'
import Papa from 'papaparse'
import { setToken, setTokenProvider, loadCSV, saveCSV, loadSettings, saveSettings, loadCouncil, saveCouncil } from '../utils/driveApi'
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../utils/googleConfig'
import { csvColumns } from '../utils/csvColumns'
import { parseCouncil, mergePayload, setReview, levelToBoardRows, councilProjectId, councilCsvToBoardRows } from '../utils/councilPlans'
import { listGuided, fetchProjectFile, markBoardSync } from '../utils/plannerApi'

const DEMO_CSV_PATH = '/operators-pm-board/data/projects.csv'

export const useStore = create((set, get) => ({
  // ── Auth (Google) ─────────────────────────────────────────────────────────
  currentUser: null,   // { name, email, picture, accessToken }
  authLoading: false,

  setAuth: async (googleUser) => {
    set({ authLoading: true })
    setToken(googleUser.accessToken)
    setTokenProvider(force => get().ensureGoogleToken(force))
    set({ currentUser: googleUser, authLoading: false })
    // Load data from Drive on sign-in
    await get().loadFromDrive()
    get().loadCouncilPlans()
    // Finished guided plans on this PC go onto the live projects page by themselves.
    get().syncGuidedExports().catch(() => {})
  },

  // Google access tokens last about an hour. Before each Drive call the board checks the token and, when it
  // is about to run out, asks Google for a new one without a password (prompt: ''). Google may flash its
  // sign-in window; if the browser blocks it, the "Reconnect Google" banner does the same on a click.
  googleExpired: false,
  ensureGoogleToken: async (force = false) => {
    const user = get().currentUser
    if (!force && user?.accessToken && user.expiresAt && user.expiresAt - Date.now() > 2 * 60 * 1000) return user.accessToken
    return get().refreshGoogleToken()
  },

  _refreshing: null,
  refreshGoogleToken: () => {
    if (get()._refreshing) return get()._refreshing
    const user = get().currentUser
    const oauth2 = window.google?.accounts?.oauth2
    const promise = new Promise((resolve, reject) => {
      if (!oauth2) return reject(new Error('Your Google sign-in has expired. Reload the page and sign in again.'))
      const client = oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (response) => {
          if (response.error) return reject(new Error(`Google sign-in expired and could not be renewed (${response.error}). Click Reconnect Google at the top.`))
          const accessToken = response.access_token
          const expiresAt = Date.now() + Number(response.expires_in ?? 3600) * 1000
          setToken(accessToken)
          set(s => ({ currentUser: { ...s.currentUser, accessToken, expiresAt }, googleExpired: false }))
          // If the local AI connector holds this session, hand it the new token too (best effort).
          fetch('http://127.0.0.1:43127/status', { cache: 'no-store' })
            .then(r => r.json()).then(st => st.connected && fetch('http://127.0.0.1:43127/session', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken, expiresAt }),
            })).catch(() => {})
          resolve(accessToken)
        },
        error_callback: (error) => {
          set({ googleExpired: true })
          reject(new Error(error?.type === 'popup_failed_to_open'
            ? 'Your Google sign-in expired and the browser blocked the window that renews it. Click Reconnect Google at the top, then try again.'
            : error?.type === 'popup_closed'
              ? 'The Google sign-in window was closed before it finished. Click Reconnect Google at the top, then try again.'
              : `Your Google sign-in expired: ${error?.message ?? error?.type ?? 'it could not be renewed'}. Click Reconnect Google at the top.`))
        },
      })
      client.requestAccessToken({ prompt: '', login_hint: user?.email })
    }).finally(() => set({ _refreshing: null }))
    set({ _refreshing: promise })
    return promise
  },

  logout: () => {
    const accessToken = get().currentUser?.accessToken ?? ''
    fetch('http://127.0.0.1:43127/session', { method: 'DELETE' }).catch(() => {})
    set({ currentUser: null, projectData: [], categories: {}, projectSettings: {}, council: { schema_version: 1, plans: {} }, googleExpired: false })
    setToken(null)
    setTokenProvider(null)
    // Revoke token via Google
    if (window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken)
    }
  },

  // ── Project data ──────────────────────────────────────────────────────────
  projectData: [],   // flat array of task rows
  categories: {},
  projectSettings: {},
  driveLoading: false,
  driveSaving: false,
  driveError: null,

  getRows: () => get().projectData,

  setRows: async (rows) => {
    set({ projectData: rows })
    return get()._saveToDrive()
  },

  loadFromDrive: async () => {
    set({ driveLoading: true, driveError: null })
    try {
      const [csvText, settings] = await Promise.all([loadCSV(), loadSettings()])

      if (csvText) {
        const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true })
        set({ projectData: data })
      }
      if (settings) {
        set({
          categories:      settings.categories      ?? {},
          projectSettings: settings.projectSettings ?? {},
        })
      }
    } catch (e) {
      set({ driveError: 'Failed to load from Drive: ' + e.message })
    } finally {
      set({ driveLoading: false })
    }
  },

  _saveToDrive: async () => {
    set({ driveSaving: true })
    try {
      const { projectData, categories, projectSettings } = get()
      await Promise.all([
        saveCSV(Papa.unparse(projectData, { columns: csvColumns(projectData) })),
        saveSettings({ categories, projectSettings }),
      ])
      set({ driveError: null })
      return true
    } catch (e) {
      set({ driveError: 'Failed to save to Drive: ' + e.message })
      return false
    } finally {
      set({ driveSaving: false })
    }
  },

  loadDemoData: async () => {
    const res  = await fetch(DEMO_CSV_PATH)
    const text = await res.text()
    const { data } = Papa.parse(text, { header: true, skipEmptyLines: true })
    set({ projectData: data })
    await get()._saveToDrive()
  },

  importCSV: async (text) => {
    const { data } = Papa.parse(text, { header: true, skipEmptyLines: true })
    const existing = get().projectData
    const map = Object.fromEntries(existing.map(r => [r.task_id, r]))
    data.forEach(r => { map[r.task_id] = r })
    const merged = Object.values(map)
    set({ projectData: merged })
    await get()._saveToDrive()
  },

  exportCSV: () => Papa.unparse(get().projectData, { columns: csvColumns(get().projectData) }),

  // ── Plan reviews (Project Council) ────────────────────────────────────────
  council: { schema_version: 1, plans: {} },
  councilLoading: false,
  councilError: null,

  loadCouncilPlans: async () => {
    set({ councilLoading: true, councilError: null })
    try {
      set({ council: parseCouncil(await loadCouncil()) })
    } catch (e) {
      set({ councilError: 'Could not load plan reviews: ' + e.message })
    } finally {
      set({ councilLoading: false })
    }
  },

  // Read the latest file first, so a level the council published a moment ago is not overwritten.
  _updateCouncil: async (change) => {
    const latest = parseCouncil(await loadCouncil())
    const next = change(latest)
    await saveCouncil(JSON.stringify(next, null, 1))
    set({ council: next })
    return next
  },

  saveLevelReview: async (planId, level, revision, review, status) =>
    get()._updateCouncil(data => setReview(data, planId, level, revision, review, status)),

  importCouncilLevel: async (text) => {
    let payload
    try { payload = JSON.parse(text) } catch { throw new Error('That file is not JSON. Choose a plan/gates/L<n>-r<k>.json file.') }
    return get()._updateCouncil(data => mergePayload(data, payload))
  },

  // Turn an approved level into a live board project (one scenario), keeping progress on re-promote.
  // A finished plan's CSV (out/plan-<scenario>.csv from the planner) as a live project. Tasks already on
  // the board keep their status, progress and position; tasks the plan dropped are removed.
  addCouncilExport: async (planId, planName, scenario, csvText) => {
    const projectId = councilProjectId(planId, scenario)
    const rows = councilCsvToBoardRows(csvText, { planId, planName, scenario })
    if (!rows.length) throw new Error('That plan file has no dated tasks.')
    const existing = get().projectData
    const prior = Object.fromEntries(existing.filter(r => r.project_id === projectId).map(r => [r.task_id, r]))
    const merged = rows.map(r => prior[r.task_id] ? { ...r, status: prior[r.task_id].status, progress: prior[r.task_id].progress, x: prior[r.task_id].x, y: prior[r.task_id].y } : r)
    // Only report success once Drive has it, so a failed save is retried next time.
    if (!await get().setRows([...existing.filter(r => r.project_id !== projectId), ...merged])) throw new Error(get().driveError ?? 'Could not save to Drive.')
    return { projectId, count: merged.length }
  },

  // For every guided plan on this PC whose exported CSV is new or changed since the board last took
  // it: put that plan (the scenario Lance picked, else bootstrap) on the live projects page.
  // Silent when the planner isn't running. Returns what it added.
  _syncingExports: false,
  syncGuidedExports: async () => {
    if (get()._syncingExports || !get().currentUser) return []
    set({ _syncingExports: true })
    const added = []
    try {
      let projects
      try { ({ projects } = await listGuided()) } catch { return [] }
      for (const p of projects) {
        const exports = p.exports ?? []
        if (!exports.length) continue
        const want = p.board_scenario || 'bootstrap'
        const e = exports.find(x => x.scenario === want) ?? exports[0]
        if (p.board_sync?.[e.scenario]?.mtime === e.mtime) continue
        const csv = await fetchProjectFile(p.slug, e.file)
        const r = await get().addCouncilExport(p.plan_id, p.name, e.scenario, csv)
        await markBoardSync(p.slug, { scenario: e.scenario, mtime: e.mtime, project_id: r.projectId, tasks: r.count })
        added.push({ name: p.name, scenario: e.scenario, ...r })
      }
    } finally { set({ _syncingExports: false }) }
    if (added.length) set({ boardNotice: `Added to your projects: ${added.map(a => `${a.name} (${a.scenario}, ${a.count} tasks)`).join('; ')}.` })
    return added
  },
  boardNotice: null,
  clearBoardNotice: () => set({ boardNotice: null }),

  promoteLevel: async (planId, level, scenario) => {
    const plan = get().council.plans?.[planId]
    if (!plan) throw new Error('Plan not found.')
    if (plan.levels?.[String(level)]?.status !== 'approved') throw new Error('Approve the level before putting it on the board.')
    const projectId = councilProjectId(planId, scenario)
    const projectName = `${plan.name} (${scenario})`
    const rows = levelToBoardRows(plan, level, scenario, projectId, projectName)
    const existing = get().projectData
    const prior = Object.fromEntries(existing.filter(r => r.project_id === projectId).map(r => [r.task_id, r]))
    const merged = rows.map(r => prior[r.task_id] ? { ...r, status: prior[r.task_id].status, progress: prior[r.task_id].progress, x: prior[r.task_id].x, y: prior[r.task_id].y } : r)
    await get().setRows([...existing.filter(r => r.project_id !== projectId), ...merged])
    return { projectId, count: merged.length }
  },

  // ── Categories ────────────────────────────────────────────────────────────
  getCategories:    () => get().categories,
  getProjectSettings: () => get().projectSettings,

  saveCategory: async (id, name, color) => {
    const cats = { ...get().categories, [id]: { name, color } }
    set({ categories: cats })
    await get()._saveToDrive()
  },

  deleteCategory: async (id) => {
    const cats     = { ...get().categories }
    const settings = { ...get().projectSettings }
    delete cats[id]
    Object.keys(settings).forEach(pid => {
      if (settings[pid]?.categoryId === id) delete settings[pid]
    })
    set({ categories: cats, projectSettings: settings })
    await get()._saveToDrive()
  },

  setProjectCategory: async (projectId, categoryId) => {
    const settings = { ...get().projectSettings }
    settings[projectId] = { ...(settings[projectId] ?? {}), categoryId }
    set({ projectSettings: settings })
    await get()._saveToDrive()
  },
}))
