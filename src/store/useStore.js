import { create } from 'zustand'
import Papa from 'papaparse'
import { setToken, loadCSV, saveCSV, loadSettings, saveSettings } from '../utils/driveApi'

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
  },

  logout: () => {
    set({ currentUser: null, projectData: [], categories: {}, projectSettings: {} })
    setToken(null)
    // Revoke token via Google
    if (window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(get().currentUser?.accessToken ?? '')
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
        saveCSV(Papa.unparse(projectData)),
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

  exportCSV: () => Papa.unparse(get().projectData),

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
