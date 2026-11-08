import { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import TaskDetail from './pages/TaskDetail'
import CompareProjects from './pages/CompareProjects'
import PlanReviews from './pages/PlanReviews'
import PlanGate from './pages/PlanGate'
import GuidedPlan from './pages/GuidedPlan'

export default function App() {
  return (
    <>
      <GoogleSessionBanner />
      <Main />
    </>
  )
}

// Google access tokens last about an hour. Drive calls renew them silently; if the browser blocked that
// (or it has simply run out while the page sat idle), this bar renews it with one click.
function GoogleSessionBanner() {
  const currentUser = useStore(s => s.currentUser)
  const expired = useStore(s => s.googleExpired)
  const refresh = useStore(s => s.refreshGoogleToken)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(t) }, [])
  if (!currentUser || (!expired && currentUser.expiresAt > now)) return null
  const reconnect = async () => {
    setBusy(true); setError('')
    try { await refresh(); setNow(Date.now()) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div role="alert" style={{
      position: 'sticky', top: 0, zIndex: 1000, background: '#3a2a10', borderBottom: '1px solid #FF9800',
      color: '#ffcc80', fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        Your Google sign-in has expired (Google limits them to about an hour), so the board can't reach Drive.
        {error && <span style={{ color: '#ef9a9a' }}> {error}</span>}
      </span>
      <button onClick={reconnect} disabled={busy} style={{
        background: '#FF9800', border: 'none', borderRadius: 6, color: '#1a1205', fontWeight: 700,
        padding: '6px 14px', cursor: 'pointer', fontSize: 13,
      }}>{busy ? 'Reconnecting…' : 'Reconnect Google'}</button>
    </div>
  )
}

function Main() {
  const currentUser  = useStore(s => s.currentUser)
  const driveLoading = useStore(s => s.driveLoading)
  const driveError   = useStore(s => s.driveError)
  const driveSaving  = useStore(s => s.driveSaving)

  const [editingProject, setEditingProject] = useState(null)
  const [viewingTask,    setViewingTask]    = useState(null)
  const [comparingProjects, setComparingProjects] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [gate, setGate] = useState(null)   // { planId, level, from }
  const [guided, setGuided] = useState(null) // { name, slug } while the guided planner is open

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
    <PlanGate key={`${gate.planId}-${gate.level}`} planId={gate.planId} level={gate.level} onBack={() => setGate(null)}
      backLabel={gate.from === 'guided' ? '← Guided session' : undefined} />
  )

  if (guided) return (
    <GuidedPlan initialName={guided.name} slug={guided.slug}
      onSlug={slug => setGuided(g => ({ ...g, slug }))}
      onBack={() => setGuided(null)}
      onOpenGate={(planId, level) => setGate({ planId, level, from: 'guided' })} />
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
      <Dashboard onEdit={setEditingProject} onTaskClick={setViewingTask} onCompare={() => setComparingProjects(true)} onReviews={() => setReviewing(true)} onGuided={name => setGuided({ name, slug: null })} />
    </>
  )
}
