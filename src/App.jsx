import { useState } from 'react'
import { useStore } from './store/useStore'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import TaskDetail from './pages/TaskDetail'
import CompareProjects from './pages/CompareProjects'
import PlanReviews from './pages/PlanReviews'
import PlanGate from './pages/PlanGate'

export default function App() {
  const currentUser  = useStore(s => s.currentUser)
  const driveLoading = useStore(s => s.driveLoading)
  const driveError   = useStore(s => s.driveError)
  const driveSaving  = useStore(s => s.driveSaving)

  const [editingProject, setEditingProject] = useState(null)
  const [viewingTask,    setViewingTask]    = useState(null)
  const [comparingProjects, setComparingProjects] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [gate, setGate] = useState(null)   // { planId, level }

  if (!currentUser) return <Login />

  if (driveLoading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 36 }}>📋</div>
      <div style={{ color: '#fff', fontWeight: 700 }}>Loading your projects…</div>
      <div style={{ color: '#555', fontSize: 13 }}>Connecting to Google Drive</div>
    </div>
  )

  if (driveError) return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ color: '#F44336', fontSize: 16 }}>⚠ {driveError}</div>
      <button onClick={() => window.location.reload()} style={{
        background: '#7c4dff', border: 'none', borderRadius: 8,
        color: '#fff', padding: '10px 24px', cursor: 'pointer', fontSize: 14,
      }}>Retry</button>
    </div>
  )

  if (editingProject) return (
    <Editor projectId={editingProject} onBack={() => setEditingProject(null)} />
  )

  if (viewingTask) return (
    <TaskDetail
      taskId={viewingTask}
      onBack={(nextTaskId) => {
        if (nextTaskId && typeof nextTaskId === 'string') setViewingTask(nextTaskId)
        else setViewingTask(null)
      }}
      onEdit={(projectId) => { setViewingTask(null); setEditingProject(projectId) }}
    />
  )

  if (comparingProjects) return <CompareProjects onBack={() => setComparingProjects(false)} />

  if (gate) return (
    <PlanGate key={`${gate.planId}-${gate.level}`} planId={gate.planId} level={gate.level} onBack={() => setGate(null)} />
  )

  if (reviewing) return (
    <PlanReviews onBack={() => setReviewing(false)} onOpenGate={(planId, level) => setGate({ planId, level })} />
  )

  return (
    <>
      {driveSaving && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 999,
          background: '#2a2a3e', borderRadius: 8, padding: '8px 14px',
          color: '#aaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
          Saving to Drive…
        </div>
      )}
      <Dashboard onEdit={setEditingProject} onTaskClick={setViewingTask} onCompare={() => setComparingProjects(true)} onReviews={() => setReviewing(true)} />
    </>
  )
}
