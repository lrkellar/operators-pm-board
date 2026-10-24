import { useState } from 'react'
import { useStore } from '../store/useStore'
import { getProjects } from '../utils/projectUtils'

const PRESET_COLORS = [
  '#7c4dff', '#2196F3', '#4CAF50', '#FF9800', '#F44336',
  '#00BCD4', '#E91E63', '#FF5722', '#9C27B0', '#607D8B',
  '#8BC34A', '#FFC107', '#3F51B5', '#009688', '#795548',
]

export default function SettingsPanel({ onClose }) {
  const {
    getCategories, saveCategory, deleteCategory,
    getProjectSettings, setProjectCategory,
    getRows,
  } = useStore()

  const categories     = getCategories()
  const projectSettings = getProjectSettings()
  const rows           = getRows()
  const projects       = getProjects(rows)

  const [editId,    setEditId]    = useState(null)  // null = new
  const [editName,  setEditName]  = useState('')
  const [editColor, setEditColor] = useState(PRESET_COLORS[0])
  const [formOpen,  setFormOpen]  = useState(false)

  const openNew = () => {
    setEditId(null)
    setEditName('')
    setEditColor(PRESET_COLORS[0])
    setFormOpen(true)
  }

  const openEdit = (id) => {
    setEditId(id)
    setEditName(categories[id].name)
    setEditColor(categories[id].color)
    setFormOpen(true)
  }

  const handleSave = () => {
    if (!editName.trim()) return
    const id = editId ?? ('cat_' + editName.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now())
    saveCategory(id, editName.trim(), editColor)
    setFormOpen(false)
  }

  const inputStyle = {
    background: '#2a2a3e', border: '1px solid #444', borderRadius: 6,
    color: '#fff', padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div style={{
        background: '#16161f', border: '1px solid #2a2a3e', borderRadius: 16,
        padding: 28, width: '100%', maxWidth: 540, maxHeight: '85vh',
        overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20,
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 17 }}>⚙️ Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* ── Categories ─────────────────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: '#aaa', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Project Categories</span>
            <button onClick={openNew} style={{
              background: '#7c4dff', border: 'none', borderRadius: 6,
              color: '#fff', fontSize: 12, fontWeight: 600, padding: '4px 12px', cursor: 'pointer',
            }}>+ New</button>
          </div>

          {Object.keys(categories).length === 0 && !formOpen && (
            <div style={{ color: '#555', fontSize: 13, padding: '8px 0' }}>No categories yet. Create one to tag your projects.</div>
          )}

          {Object.entries(categories).map(([id, cat]) => (
            <div key={id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', background: '#1e1e2e', borderRadius: 8, marginBottom: 6,
            }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: cat.color, flexShrink: 0 }} />
              <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{cat.name}</span>
              <button onClick={() => openEdit(id)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 12 }}>Edit</button>
              <button onClick={() => deleteCategory(id)} style={{ background: 'none', border: 'none', color: '#F44336', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          ))}

          {/* inline form */}
          {formOpen && (
            <div style={{ background: '#1e1e2e', borderRadius: 10, padding: 14, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input style={inputStyle} placeholder="Category name" value={editName} onChange={e => setEditName(e.target.value)} />
              <div>
                <div style={{ color: '#aaa', fontSize: 11, marginBottom: 6 }}>Color</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map(c => (
                    <div key={c} onClick={() => setEditColor(c)} style={{
                      width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer',
                      outline: editColor === c ? '2px solid #fff' : 'none',
                      outlineOffset: 2,
                    }} />
                  ))}
                  {/* custom color picker */}
                  <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                    style={{ width: 24, height: 24, padding: 0, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none' }}
                    title="Custom color"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleSave} style={{
                  flex: 1, background: editColor, border: 'none', borderRadius: 6,
                  color: '#fff', fontWeight: 700, padding: '7px 0', cursor: 'pointer', fontSize: 13,
                }}>Save</button>
                <button onClick={() => setFormOpen(false)} style={{
                  background: '#333', border: 'none', borderRadius: 6,
                  color: '#aaa', padding: '7px 14px', cursor: 'pointer', fontSize: 13,
                }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Assign categories to projects ───────────────────────────── */}
        {projects.length > 0 && Object.keys(categories).length > 0 && (
          <div>
            <div style={{ color: '#aaa', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Assign Categories to Projects
            </div>
            {projects.map(p => {
              const assigned = projectSettings[p.id]?.categoryId ?? ''
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', background: '#1e1e2e', borderRadius: 8, marginBottom: 6,
                }}>
                  {assigned && categories[assigned] && (
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: categories[assigned].color, flexShrink: 0 }} />
                  )}
                  <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{p.name}</span>
                  <select
                    value={assigned}
                    onChange={e => setProjectCategory(p.id, e.target.value)}
                    style={{ ...inputStyle, width: 'auto', minWidth: 140 }}
                  >
                    <option value="">— unassigned —</option>
                    {Object.entries(categories).map(([id, cat]) => (
                      <option key={id} value={id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
