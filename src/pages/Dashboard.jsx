import { useState } from 'react'
import { useStore } from '../store/useStore'
import { getProjects } from '../utils/projectUtils'
import ProjectCard from '../components/ProjectCard'
import SettingsPanel from '../components/SettingsPanel'
import CalendarWidget from '../components/CalendarWidget'

export default function Dashboard({ onEdit, onTaskClick }) {
  const { getRows, setRows, loadDemoData, exportCSV, importCSV, logout, getCategories, getProjectSettings } = useStore()
  const currentUser = useStore(s => s.currentUser)
  const [viewMode,      setViewMode]      = useState('Gantt')
  const [importMsg,     setImportMsg]     = useState('')
  const [newProjOpen,   setNewProjOpen]   = useState(false)
  const [newProjName,   setNewProjName]   = useState('')
  const [newProjErr,    setNewProjErr]    = useState('')
  const [settingsOpen,  setSettingsOpen]  = useState(false)

  const handleNewProject = () => {
    const name = newProjName.trim()
    if (!name) { setNewProjErr('Project name is required.'); return }
    const id = 'proj_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 24)
    const rows = getRows()
    if (rows.some(r => r.project_id === id)) { setNewProjErr('A project with that name already exists.'); return }
    // seed one placeholder task so the project exists in the store
    const today = new Date().toISOString().slice(0, 10)
    const newRow = {
      project_id: id, project_name: name, task_id: `${id}_01`,
      task_name: 'First Task', start_date: today, end_date: today,
      progress: 0, dependencies: '', assignee: '', status: 'not_started',
      type: 'task', x: 100, y: 100, file_link: '', notes: '',
    }
    setRows([...rows, newRow])
    setNewProjOpen(false)
    setNewProjName('')
    setNewProjErr('')
    onEdit(id)
  }

  const handleDeleteProject = (projectId) => {
    const rows = getRows()
    setRows(rows.filter(r => r.project_id !== projectId))
  }

  const rows            = getRows()
  const projects        = getProjects(rows)
  const categories      = getCategories()
  const projectSettings = getProjectSettings()

  // stats
  const total   = rows.length
  const done    = rows.filter(r => r.status === 'complete').length
  const overdue = rows.filter(r => r.status === 'overdue').length
  const atRisk  = rows.filter(r => r.status === 'at_risk').length

  const handleExport = () => {
    const csv  = exportCSV()
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'projects.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      importCSV(ev.target.result)
      setImportMsg('Imported ✓')
      setTimeout(() => setImportMsg(''), 2500)
    }
    reader.readAsText(file)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', color: '#fff' }}>
      {/* navbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '12px 24px', background: '#16161f', borderBottom: '1px solid #2a2a3e',
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <span style={{ fontWeight: 800, fontSize: 18, flex: 1 }}>📋 The Operators PM Board</span>

        <select
          value={viewMode}
          onChange={e => setViewMode(e.target.value)}
          style={{
            background: '#2a2a3e', border: '1px solid #444', color: '#fff',
            borderRadius: 6, padding: '5px 10px', fontSize: 13,
          }}
        >
          <option value="Gantt">Gantt Chart</option>
          <option value="CPM">Critical Path (CPM)</option>
        </select>

        <button onClick={() => { setNewProjOpen(true); setNewProjName(''); setNewProjErr('') }} style={navBtn('#7c4dff')}>+ New Project</button>
        <button onClick={() => setSettingsOpen(true)} style={navBtn('#2a2a3e')}>⚙️ Settings</button>
        <button onClick={handleExport} style={navBtn('#2a2a3e')}>⬇ Export CSV</button>        <label style={{ ...navBtn('#2a2a3e'), cursor: 'pointer' }}>
          ⬆ Import CSV
          <input type="file" accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
        </label>
        {importMsg && <span style={{ color: '#4CAF50', fontSize: 13 }}>{importMsg}</span>}

        <button onClick={logout} style={navBtn('#333')}>Logout</button>
        {currentUser?.picture && (
          <img src={currentUser.picture} alt={currentUser.name}
            title={currentUser.name}
            style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #2a2a3e', cursor: 'pointer' }}
            onClick={logout}
          />
        )}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
        {/* summary metrics */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Tasks',  value: total,   color: '#aaa' },
            { label: 'Completed',    value: done,    color: '#4CAF50' },
            { label: 'Overdue',      value: overdue, color: '#F44336' },
            { label: 'At Risk',      value: atRisk,  color: '#FF9800' },
          ].map(m => (
            <div key={m.label} style={{
              flex: '1 1 120px', background: '#16161f', borderRadius: 10,
              padding: '14px 18px', border: '1px solid #2a2a3e',
            }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* calendar — full width outside the constrained container */}
      {projects.length > 0 && (
        <div style={{ padding: '0 24px', marginBottom: 0 }}>
          <CalendarWidget
            projects={projects}
            categories={categories}
            projectSettings={projectSettings}
            onTaskClick={onTaskClick}
          />
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px 24px' }}>

        {/* project cards */}
        {projects.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#555', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ marginBottom: 16 }}>No projects yet.</div>
            <button onClick={loadDemoData} style={navBtn('#7c4dff')}>Load Demo Data</button>
          </div>
        ) : (
          projects.map(p => {
              const catId    = projectSettings[p.id]?.categoryId
              const catColor = catId && categories[catId] ? categories[catId].color : undefined
              return (
                <ProjectCard key={p.id} project={p} viewMode={viewMode}
                  onEdit={onEdit} onDelete={handleDeleteProject}
                  categoryColor={catColor} onTaskClick={onTaskClick} />
              )
            })
        )}
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {/* new project modal */}
      {newProjOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }} onClick={() => setNewProjOpen(false)}>
          <div style={{
            background: '#16161f', border: '1px solid #7c4dff', borderRadius: 14,
            padding: 28, width: '100%', maxWidth: 360,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 16 }}>New Project</div>
            <input
              autoFocus
              style={{
                width: '100%', background: '#1e1e2e', border: '1px solid #444',
                borderRadius: 8, color: '#fff', padding: '10px 12px',
                fontSize: 14, boxSizing: 'border-box', marginBottom: 8,
              }}
              placeholder="Project name"
              value={newProjName}
              onChange={e => { setNewProjName(e.target.value); setNewProjErr('') }}
              onKeyDown={e => e.key === 'Enter' && handleNewProject()}
            />
            {newProjErr && <div style={{ color: '#F44336', fontSize: 12, marginBottom: 8 }}>{newProjErr}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={handleNewProject} style={{ ...navBtn('#7c4dff'), flex: 1, justifyContent: 'center' }}>
                Create &amp; Open Editor
              </button>
              <button onClick={() => setNewProjOpen(false)} style={navBtn('#333')}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const navBtn = (bg) => ({
  background: bg, border: 'none', borderRadius: 6, color: '#fff',
  padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', gap: 4,
})
