import { create } from 'zustand'
import Papa from 'papaparse'
import { setToken, loadCSV, saveCSV, loadSettings, saveSettings, loadCouncil, saveCouncil } from '../utils/driveApi'
import { csvColumns } from '../utils/csvColumns'
import { parseCouncil, mergePayload, setReview, levelToBoardRows } from '../utils/councilPlans'

const DEMO_CSV_PATH = '/operators-pm-board/data/projects.csv'

export const useStore = create((set, get) => ({
  // ── Auth (Google) ─────────────────────────────────────────────────────────
  currentUser: null,   // { name, email, picture, accessToken }
  authLoading: false,

  setAuth: async (googleUser) => {
    set({ authLoading: true })
    setToken(googleUser.accessToken)
    set({ currentUser: googleUser, authLoading: false })
    // Load data from Drive on sign-in
    await get().loadFromDrive()
    get().loadCouncilPlans()
  },

  logout: () => {
    const accessToken = get().currentUser?.accessToken ?? ''
    fetch('http://127.0.0.1:43127/session', { method: 'DELETE' }).catch(() => {})
    set({ currentUser: null, projectData: [], categories: {}, projectSettings: {}, council: { schema_version: 1, plans: {} } })
    setToken(null)
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
    await get()._saveToDrive()
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
    } catch (e) {
      set({ driveError: 'Failed to save to Drive: ' + e.message })
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
  promoteLevel: async (planId, level, scenario) => {
    const plan = get().council.plans?.[planId]
    if (!plan) throw new Error('Plan not found.')
    if (plan.levels?.[String(level)]?.status !== 'approved') throw new Error('Approve the level before putting it on the board.')
    const projectId = `proj_council_${planId}_${scenario}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
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
