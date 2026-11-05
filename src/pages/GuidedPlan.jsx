import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  plannerStatus, listGuided, startGuided, getGuided, replyGuided, retryGuided, stopGuided, fetchGateFile,
} from '../utils/plannerApi'
import { LEVEL_NAMES } from '../utils/councilPlans'

// The guided New Project flow. The council runs on this PC through the planner (headless Claude Code on
// Lance's Claude subscription); this page shows each turn's question and sends his answer back.
export default function GuidedPlan({ initialName = '', slug, onSlug, onBack, onOpenGate }) {
  const [status, setStatus] = useState(null)        // planner /status, or { offline: true }
  const [checking, setChecking] = useState(false)

  const check = useCallback(async (fresh = false) => {
    setChecking(true)
    try { setStatus(await plannerStatus(fresh)) } catch (e) { setStatus({ offline: true, error: e.message }) }
    finally { setChecking(false) }
  }, [])
  useEffect(() => { check() }, [check])

  const ready = status && !status.offline && status.auth?.subscription && status.paths?.library_ok && status.paths?.plugin_ok

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', color: '#fff' }}>
      <div style={bar}>
        <button onClick={onBack} style={btn('#333')}>← Dashboard</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>🧭 Plan with the council</span>
        <PlannerChip status={status} checking={checking} onCheck={() => check(true)} />
      </div>
      {!status ? <div style={{ padding: 40, color: '#888' }}>Looking for the planner on this computer…</div>
        : !ready ? <SetupCard status={status} onCheck={() => check(true)} checking={checking} />
          : slug ? <Session slug={slug} onOpenGate={onOpenGate} />
            : <Start initialName={initialName} onStarted={onSlug} />}
    </div>
  )
}

// ── planner status ────────────────────────────────────────────────────────────────────────────
function PlannerChip({ status, checking, onCheck }) {
  let color = '#888', text = 'Checking…'
  if (status?.offline) { color = '#F44336'; text = 'Planner not running' }
  else if (status && !status.auth?.subscription) { color = '#FF9800'; text = 'Claude sign-in needed' }
  else if (status) { color = '#4CAF50'; text = `Claude subscription · ${status.auth.authMethod}` }
  return (
    <button onClick={onCheck} title="Check the planner again" style={{ ...btn('#1e1e2e'), border: `1px solid ${color}`, color }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' }} />
      {checking ? 'Checking…' : text}
    </button>
  )
}

function SetupCard({ status, onCheck, checking }) {
  const a = status.auth || {}
  const p = status.paths || {}
  const steps = [
    { done: !status.offline, title: 'Start the planner on this PC',
      body: <>In the board's folder, double-click <code style={code}>Start planner.cmd</code> (or run <code style={code}>npm run planner</code>). Leave that window open while you plan.</> },
    { done: !status.offline && a.installed, title: 'Install Claude Code',
      body: <>The planner drives Claude Code in the background. Install it from <code style={code}>claude.com/download</code> or with <code style={code}>npm install -g @anthropic-ai/claude-code</code>.</> },
    { done: !status.offline && a.subscription, title: 'Sign in with your Claude account',
      body: <>Open a terminal, run <code style={code}>claude</code> once and sign in with your Claude (Pro or Max) account, not a Console API key. The planner refuses to run on an API key, so it never bills per token.</> },
    { done: !status.offline && p.library_ok && p.plugin_ok, title: 'Point it at the council',
      body: <>Library: <code style={code}>{p.library || '…\\project-council-library'}</code>{p.library_ok === false && ' (not found)'}<br />
        Plugin: <code style={code}>{p.plugin || '…\\project-council'}</code>{p.plugin_ok === false && ' (not found)'}<br />
        Change these in <code style={code}>planner\planner.config.json</code> if your folders differ.</> },
  ]
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px' }}>
      <h2 style={{ fontSize: 20, margin: '0 0 6px' }}>Set up the planner once</h2>
      <p style={{ color: '#9a9ab0', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Planning runs on your own computer with Claude Code signed in to your Claude subscription, so it uses your plan's
        usage, never API credits. Your Google sign-in here only reaches Drive; the planner never sees it.
      </p>
      {(a.problem || status.error) && <div style={{ ...card, borderColor: '#FF9800', color: '#ffcc80', fontSize: 13 }}>{status.offline ? status.error : a.problem}</div>}
      {steps.map((s, i) => (
        <div key={i} style={{ ...card, display: 'flex', gap: 14, opacity: s.done ? 0.6 : 1 }}>
          <div style={{ width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13,
            background: s.done ? '#1b5e20' : '#2a2a3e', color: s.done ? '#a5d6a7' : '#fff' }}>{s.done ? '✓' : i + 1}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.title}</div>
            <div style={{ color: '#aaa', fontSize: 13, lineHeight: 1.6 }}>{s.body}</div>
          </div>
        </div>
      ))}
      <button onClick={onCheck} style={btn('#7c4dff')}>{checking ? 'Checking…' : 'Check again'}</button>
    </div>
  )
}

// ── start a new guided plan, or resume one ────────────────────────────────────────────────────
function Start({ initialName, onStarted }) {
  const [name, setName] = useState(initialName)
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sessions, setSessions] = useState([])
  useEffect(() => { listGuided().then(r => setSessions(r.projects)).catch(() => {}) }, [])

  const go = async () => {
    setErr(''); setBusy(true)
    try { const r = await startGuided(name, idea); onStarted(r.slug) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 16px' }}>
      <h2 style={{ fontSize: 20, margin: '0 0 6px' }}>What do you want to plan?</h2>
      <p style={{ color: '#9a9ab0', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Describe it the way you'd tell a friend: what it is, who it's for, what you picture it doing, and any limits on time or money.
        The scoping lead will interview you one question at a time, then an expert panel walks you through the decisions that shape
        everything else, before any detail is planned.
      </p>
      <label style={label}>Project name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Work backpack with stool" style={input} />
      <label style={label}>Your idea, in your own words</label>
      <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={8} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
        placeholder="I want a backpack for long site shifts that has a folding stool built in, so I can sit anywhere. It has to carry my tools…" />
      {err && <div style={{ color: '#F44336', fontSize: 13, margin: '8px 0' }}>{err}</div>}
      <button disabled={busy} onClick={go} style={{ ...btn('#7c4dff'), padding: '10px 20px', fontSize: 14, marginTop: 8 }}>
        {busy ? 'Starting…' : 'Start the scoping interview →'}
      </button>

      {sessions.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Pick up where you left off</div>
          {sessions.map(s => (
            <button key={s.slug} onClick={() => onStarted(s.slug)} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer', color: '#fff', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontWeight: 700, flex: 1 }}>{s.name}</span>
              <span style={{ fontSize: 12, color: '#9a9ab0' }}>{stageLabel(s.phase, s.level)}</span>
              <span style={{ fontSize: 12, color: STATUS[s.status]?.color ?? '#888' }}>{STATUS[s.status]?.label ?? s.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS = {
  new: { label: 'Starting', color: '#888' },
  running: { label: 'Council working', color: '#64b5f6' },
  waiting: { label: 'Your answer needed', color: '#ffb74d' },
  waiting_review: { label: 'Gate review waiting', color: '#ffb74d' },
  limit: { label: 'Paused: usage limit', color: '#FF9800' },
  error: { label: 'Stopped with an error', color: '#F44336' },
  done: { label: 'Done', color: '#4CAF50' },
}

// ── the session ───────────────────────────────────────────────────────────────────────────────
const RAIL = [
  { key: 'brief', title: 'Brief', sub: 'Scoping interview' },
  { key: 'panel', title: 'Panel', sub: 'Your experts' },
  ...LEVEL_NAMES.map((n, i) => ({ key: `L${i}`, title: `L${i} ${n}`, sub: i === 0 ? 'Is this the right project?' : i === 1 ? 'Is this the right way?' : i === 2 ? 'Does it fit time and money?' : 'Current stage' })),
  { key: 'wrap', title: 'Wrap-up', sub: 'Exports and lessons' },
]
function railKey(phase, level) {
  if (!phase || phase === 'setup' || phase === 'brief') return 'brief'
  if (phase === 'panel') return 'panel'
  if (phase === 'wrap') return 'wrap'
  if ((phase === 'level' || phase === 'decisions') && level != null) return `L${level}`
  return 'brief'
}
function stageLabel(phase, level) {
  const r = RAIL.find(x => x.key === railKey(phase, level))
  return phase === 'decisions' ? `${r.title} · decisions` : r.title
}

function Session({ slug, onOpenGate }) {
  const [view, setView] = useState(null)
  const [events, setEvents] = useState([])
  const [err, setErr] = useState('')
  const since = useRef(0)
  const turn = useRef(null)

  const refresh = useCallback(async () => {
    try {
      let v = await getGuided(slug, since.current)
      if (v.session.turns !== turn.current) {
        // A new turn restarts the activity feed.
        turn.current = v.session.turns
        if (since.current) v = await getGuided(slug, 0)
        setEvents(v.events)
      } else if (v.events.length) {
        setEvents(ev => [...ev, ...v.events])
      }
      if (v.events.length) since.current = v.events[v.events.length - 1].seq
      setView(v); setErr('')
    } catch (e) { setErr(e.message) }
  }, [slug])

  useEffect(() => { refresh() }, [refresh])
  const running = view?.running
  const waitingReview = view?.session?.status === 'waiting_review'
  useEffect(() => {
    const t = setInterval(refresh, running ? 1500 : waitingReview ? 6000 : 15000)
    return () => clearInterval(t)
  }, [refresh, running, waitingReview])

  if (!view) return <div style={{ padding: 40, color: err ? '#F44336' : '#888' }}>{err || 'Loading the session…'}</div>

  const s = view.session
  const claudeTurns = view.transcript.filter(e => e.role === 'claude')
  const lastUi = s.last_ui || claudeTurns[claudeTurns.length - 1]?.ui
  const cur = railKey(lastUi?.phase, lastUi?.level)
  const curIdx = RAIL.findIndex(r => r.key === cur)
  const lastEntry = view.transcript[view.transcript.length - 1]
  const activeUi = !running && lastEntry?.role === 'claude' ? lastEntry.ui : null

  const send = async (answer) => {
    setErr('')
    try { await replyGuided(slug, answer); await refresh() } catch (e) { setErr(e.message) }
  }
  const retry = async () => { setErr(''); try { await retryGuided(slug); await refresh() } catch (e) { setErr(e.message) } }
  const stop = async () => { try { await stopGuided(slug) } catch (e) { setErr(e.message) } }

  return (
    <div style={{ display: 'flex', gap: 24, maxWidth: 1180, margin: '0 auto', padding: '20px 16px', flexWrap: 'wrap' }}>
      <aside style={{ width: 220, flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{s.name}</div>
        <div style={{ fontSize: 12, color: STATUS[s.status]?.color ?? '#888', marginBottom: 16 }}>{STATUS[s.status]?.label ?? s.status}</div>
        {RAIL.map((r, i) => (
          <div key={r.key} style={{ display: 'flex', gap: 10, padding: '7px 0', opacity: i > curIdx ? 0.45 : 1 }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, marginTop: 1, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800,
              background: i < curIdx ? '#2e7d32' : i === curIdx ? '#7c4dff' : '#2a2a3e' }}>{i < curIdx ? '✓' : ''}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: i === curIdx ? 800 : 600 }}>{r.title}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{i === curIdx && lastUi?.step ? lastUi.step : r.sub}</div>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: '#666', marginTop: 16, lineHeight: 1.5 }}>
          Runs on your PC with your Claude subscription{s.model ? ` (${s.model})` : ''}. Files: <code style={code}>projects\{s.slug}</code>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 300 }}>
        {view.transcript.map((e, i) => {
          const isActive = e === lastEntry && e.role === 'claude' && !running
          if (e.role === 'author') return <AuthorBubble key={i} e={e} />
          if (e.role === 'system') return <SystemLine key={i} e={e} />
          return <ClaudeBubble key={i} e={e} active={isActive} />
        })}

        {running && <Activity events={events} elapsed={view.elapsed} onStop={stop} />}
        {!running && s.status === 'limit' && <LimitCard session={s} onContinue={retry} />}
        {!running && s.status === 'error' && (
          <div style={{ ...card, borderColor: '#F44336' }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: '#ef9a9a' }}>The council stopped with an error</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#ccc', margin: '0 0 12px' }}>{s.error}</pre>
            <button onClick={retry} style={btn('#7c4dff')}>Try again</button>
          </div>
        )}
        {activeUi && <Answer ui={activeUi} slug={slug} planId={s.plan_id} onSend={send} onOpenGate={onOpenGate} />}
        {err && <div style={{ color: '#F44336', fontSize: 13, margin: '10px 0' }}>{err}</div>}
      </main>
    </div>
  )
}

function AuthorBubble({ e }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
      <div style={{ maxWidth: '80%', background: '#2b2350', border: '1px solid #4a3d8a', borderRadius: '12px 12px 2px 12px', padding: '10px 14px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {e.kind === 'idea' && <div style={{ fontSize: 11, color: '#b3a6ff', fontWeight: 700, marginBottom: 4 }}>YOUR IDEA</div>}
        {e.kind === 'review' && <div style={{ fontSize: 11, color: '#b3a6ff', fontWeight: 700, marginBottom: 4 }}>GATE REVIEW</div>}
        {e.text}
      </div>
    </div>
  )
}

function SystemLine({ e }) {
  return <div style={{ textAlign: 'center', fontSize: 12, color: e.kind === 'limit' ? '#FF9800' : '#ef9a9a', margin: '10px 0' }}>
    {e.kind === 'limit' ? '⏸ Paused at your plan\'s usage limit' : '⚠ ' + String(e.text).split('\n')[0].slice(0, 160)}
  </div>
}

function ClaudeBubble({ e, active }) {
  const ui = e.ui || {}
  return (
    <div style={{ margin: '12px 0', maxWidth: 820 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
        THE COUNCIL{ui.step ? ` · ${ui.step}` : ''}{e.activity ? ` · ${e.activity} actions` : ''}{e.seconds > 30 ? ` · ${fmtDur(e.seconds)}` : ''}
      </div>
      <div style={{ background: '#16161f', border: '1px solid #2a2a3e', borderRadius: '12px 12px 12px 2px', padding: '12px 16px' }}>
        <Md text={ui.say} />
        {ui.files?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {ui.files.map(f => <span key={f} style={{ ...code, fontSize: 11, padding: '3px 8px' }}>📄 {f}</span>)}
          </div>
        )}
        {!active && ui.ask?.question && <div style={{ marginTop: 10, color: '#b3a6ff', fontSize: 13, fontStyle: 'italic' }}>{ui.ask.question}</div>}
        {ui.parse_error && <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>({ui.parse_error} Answer in your own words.)</div>}
      </div>
    </div>
  )
}

function Activity({ events, elapsed, onStop }) {
  const [all, setAll] = useState(false)
  const shown = events.filter(e => all || !e.quiet)
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [shown.length])
  return (
    <div style={{ ...card, borderColor: '#3949ab' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ display: 'inline-block', animation: 'spin 1.2s linear infinite' }}>⟳</span>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>The council is working{elapsed != null ? ` · ${fmtDur(elapsed)}` : ''}</span>
        <button onClick={() => setAll(a => !a)} style={btn('#2a2a3e')}>{all ? 'Fewer details' : 'All details'}</button>
        <button onClick={onStop} style={btn('#5d2a2a')} title="Stop this turn. Work already written to files is kept.">Stop</button>
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', fontSize: 12.5, lineHeight: 1.6 }}>
        {shown.length === 0 && <div style={{ color: '#888' }}>Starting…</div>}
        {shown.map(e => (
          <div key={e.seq} style={{ paddingLeft: e.depth ? 18 : 0, color: e.kind === 'error' ? '#ef9a9a' : e.kind === 'text' ? '#cfcfe6' : e.quiet ? '#777' : '#aaa' }}>
            <span style={{ display: 'inline-block', width: 20 }}>{e.icon}</span>{e.agent ? <b style={{ color: '#9fa8da' }}>{e.agent} </b> : null}{e.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>Long steps like writing a level can take a while. You can leave this page; the work carries on on your PC.</div>
    </div>
  )
}

function LimitCard({ session, onContinue }) {
  const reset = session.limit_reset ? new Date(session.limit_reset) : null
  return (
    <div style={{ ...card, borderColor: '#FF9800' }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#ffcc80' }}>Paused: your Claude plan's usage limit was reached</div>
      <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.6, marginBottom: 12 }}>
        Nothing is billed and nothing is lost: the work done so far is saved in the project folder.
        {reset ? <> The limit resets around <b>{reset.toLocaleString()}</b>.</> : ' Try again once your limit resets.'}
      </div>
      <button onClick={onContinue} style={btn('#7c4dff')}>Continue</button>
    </div>
  )
}

// ── answering a turn ──────────────────────────────────────────────────────────────────────────
function Answer({ ui, slug, planId, onSend, onOpenGate }) {
  const ask = ui.ask || { kind: 'text' }
  const multiDefault = Array.isArray(ask.default) ? ask.default : []
  const [pick, setPick] = useState(ask.kind === 'choice' && typeof ask.default === 'string' ? ask.default : null)
  const [picks, setPicks] = useState(multiDefault)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const options = ask.options || []

  const submit = async () => {
    setBusy(true)
    try {
      if (ask.kind === 'choice' && pick) await onSend({ choice: optOf(options, pick), text })
      else if (ask.kind === 'multi') await onSend({ choice: picks.map(id => optOf(options, id)), text })
      else await onSend({ text })
    } finally { setBusy(false) }
  }
  const canSend = (ask.kind === 'choice' && (pick || text.trim())) || ask.kind === 'multi' || text.trim()

  return (
    <div style={{ ...card, borderColor: '#7c4dff', marginTop: 8 }}>
      {ask.question && <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, lineHeight: 1.4 }}>{ask.question}</div>}

      {ui.decision && <DecisionCard d={ui.decision} pick={ask.kind === 'choice' ? pick : null} onPick={ask.kind === 'choice' ? setPick : null} />}

      {ask.kind === 'choice' && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {options.filter(o => !ui.decision || o.id === 'test' || !ui.decision.options?.some(d => d.id === o.id)).map(o => (
            <OptionButton key={o.id} o={o} on={pick === o.id} onClick={() => setPick(pick === o.id ? null : o.id)} />
          ))}
          {ui.decision && <div style={{ fontSize: 12, color: '#888' }}>Pick an option above{options.some(o => o.id === 'test') ? ', or test first' : ''}.</div>}
        </div>
      )}

      {ask.kind === 'multi' && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {options.map(o => (
            <OptionButton key={o.id} o={o} on={picks.includes(o.id)} check
              onClick={() => setPicks(p => p.includes(o.id) ? p.filter(x => x !== o.id) : [...p, o.id])} />
          ))}
        </div>
      )}

      {ask.kind === 'gate' && ui.gate && <GateCard gate={ui.gate} slug={slug} planId={planId} onOpenGate={onOpenGate} />}
      {ask.kind === 'done' && <div style={{ color: '#a5d6a7', fontSize: 14, marginBottom: 12 }}>✓ This plan is finished. The exports are in the project folder.</div>}
      {ask.kind === 'wait' && <div style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>Nothing is needed from you right now.</div>}

      <textarea value={text} onChange={e => setText(e.target.value)} rows={ask.kind === 'text' ? 4 : 2}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSend) submit() }}
        placeholder={ask.kind === 'text' ? 'Your answer… (Ctrl+Enter to send)'
          : ask.kind === 'gate' ? 'Or tell the council something without reviewing yet…'
            : ask.allow_other === false ? 'Add a note (optional)' : 'Add a note, or answer in your own words instead'}
        style={{ ...input, resize: 'vertical', lineHeight: 1.5, marginBottom: 10 }} />
      <button disabled={!canSend || busy} onClick={submit} style={{ ...btn(canSend ? '#7c4dff' : '#333'), padding: '8px 18px' }}>
        {busy ? 'Sending…' : 'Send to the council'}
      </button>
    </div>
  )
}

const optOf = (options, id) => { const o = options.find(x => x.id === id); return { id, label: o?.label ?? id } }

function OptionButton({ o, on, onClick, check }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', background: on ? '#2b2350' : '#1e1e2e', border: `1px solid ${on ? '#7c4dff' : '#333'}`, borderRadius: 8,
      color: '#fff', padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <span style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1, borderRadius: check ? 4 : 8, border: `2px solid ${on ? '#b3a6ff' : '#555'}`,
        background: on ? '#7c4dff' : 'transparent', fontSize: 10, display: 'grid', placeItems: 'center' }}>{on && check ? '✓' : ''}</span>
      <span>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{o.id === 'test' ? '🧪 ' : ''}{o.label}</span>
        {o.detail && <span style={{ display: 'block', color: '#9a9ab0', fontSize: 12, marginTop: 2 }}>{o.detail}</span>}
      </span>
    </button>
  )
}

function DecisionCard({ d, pick, onPick }) {
  const opts = d.options || []
  const rec = d.recommendation?.option
  const effectKeys = [...new Set(opts.flatMap(o => Object.keys(o.effects || {})))]
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: '#9a9ab0', marginBottom: 10, lineHeight: 1.5 }}>
        <b style={{ color: '#ddd' }}>{d.id} · {d.title}</b>{d.why_it_matters ? ` — ${d.why_it_matters}` : ''}
        {d.lead_seat && <> Framed by the <b>{nice(d.lead_seat)}</b>{d.takes?.length ? ` with ${d.takes.map(t => nice(t.seat)).join(', ')}` : ''}.</>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${opts.length > 3 ? 180 : 210}px, 1fr))`, gap: 10 }}>
        {opts.map(o => {
          const on = pick === o.id
          return (
            <div key={o.id} onClick={onPick ? () => onPick(on ? null : o.id) : undefined} style={{
              background: on ? '#2b2350' : '#1e1e2e', border: `1px solid ${on ? '#7c4dff' : rec === o.id ? '#4a6b3d' : '#333'}`, borderRadius: 10,
              padding: 12, cursor: onPick ? 'pointer' : 'default', position: 'relative',
            }}>
              {rec === o.id && <div style={{ position: 'absolute', top: -9, right: 10, background: '#2e7d32', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 8 }}>RECOMMENDED</div>}
              <div style={{ fontWeight: 800, fontSize: 14 }}>{o.id} · {o.title || o.label}</div>
              {o.summary && <div style={{ fontSize: 12, color: '#bbb', margin: '4px 0 8px', lineHeight: 1.5 }}>{o.summary}</div>}
              {(o.pros || []).map((p, i) => <div key={'p' + i} style={{ fontSize: 12, color: '#a5d6a7', lineHeight: 1.5 }}>+ {p}</div>)}
              {(o.cons || []).map((c, i) => <div key={'c' + i} style={{ fontSize: 12, color: '#ef9a9a', lineHeight: 1.5 }}>− {c}</div>)}
              {effectKeys.length > 0 && (
                <div style={{ marginTop: 8, borderTop: '1px solid #2a2a3e', paddingTop: 6 }}>
                  {effectKeys.map(k => (
                    <div key={k} style={{ display: 'flex', fontSize: 11.5, lineHeight: 1.6 }}>
                      <span style={{ color: '#888', flex: 1 }}>{nice(k)}</span>
                      <span style={{ color: '#ddd' }}>{fmtEffect(o.effects?.[k])}</span>
                    </div>
                  ))}
                </div>
              )}
              {onPick && <div style={{ marginTop: 8, fontSize: 11, color: on ? '#b3a6ff' : '#666', fontWeight: 700 }}>{on ? '● Your choice' : '○ Choose this'}</div>}
            </div>
          )
        })}
      </div>
      {(d.takes?.length > 0 || d.recommendation) && (
        <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.6 }}>
          {(d.takes || []).map(t => <div key={t.seat}><b style={{ color: '#9fa8da' }}>{nice(t.seat)}</b> leans {t.leans}: <span style={{ color: '#bbb' }}>{t.why}</span></div>)}
          {d.recommendation && <div style={{ marginTop: 4 }}><b style={{ color: '#a5d6a7' }}>Recommendation: {d.recommendation.option}.</b> <span style={{ color: '#bbb' }}>{d.recommendation.why}</span></div>}
          {d.test && <div style={{ marginTop: 4, color: '#bbb' }}>🧪 <b style={{ color: '#ddd' }}>Cheap test:</b> {d.test.summary}{d.test.hours != null ? ` · ${d.test.hours} h` : ''}{d.test.cash != null ? ` · $${d.test.cash}` : ''}</div>}
          {d.impact && <div style={{ marginTop: 4, color: '#ffcc80' }}>⚠ {d.impact}</div>}
        </div>
      )}
    </div>
  )
}

function GateCard({ gate, slug, planId, onOpenGate }) {
  const council = useStore(s => s.council)
  const importCouncilLevel = useStore(s => s.importCouncilLevel)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const lv = council.plans?.[planId]?.levels?.[String(gate.level)]
  const onBoard = Boolean(lv?.revisions?.some(r => r.revision === gate.revision && r.payload))
  const reviewed = onBoard && lv?.revisions?.find(r => r.revision === gate.revision)?.review?.decision

  const open = async () => {
    setErr(''); setBusy(true)
    try {
      if (!onBoard) await importCouncilLevel(await fetchGateFile(slug, gate.file))
      onOpenGate(planId, gate.level)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ background: '#1a2230', border: '1px solid #1565c0', borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>L{gate.level} {LEVEL_NAMES[gate.level]} · revision {gate.revision} is ready</div>
      <div style={{ color: '#9ab', fontSize: 12.5, margin: '4px 0 10px', lineHeight: 1.5 }}>
        {gate.question || 'Review it item by item on the gate page, then approve it or send it back.'} When you press <b>Approve</b> or <b>Send back</b>, the
        council picks it up automatically.
      </div>
      {gate.exists === false && <div style={{ color: '#ef9a9a', fontSize: 12, marginBottom: 8 }}>The gate file was not found in the project folder. Ask the council to publish it again.</div>}
      <button disabled={busy || gate.exists === false} onClick={open} style={btn('#1565c0')}>
        {busy ? 'Putting it on the board…' : reviewed ? 'Open the review again' : onBoard ? 'Open the review' : 'Put it on the board and review'}
      </button>
      {err && <div style={{ color: '#F44336', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  )
}

// ── tiny markdown ─────────────────────────────────────────────────────────────────────────────
function Md({ text }) {
  const html = useMemo(() => mdToHtml(text || ''), [text])
  return <div className="council-md" style={{ fontSize: 13.5, lineHeight: 1.6, color: '#ddd' }} dangerouslySetInnerHTML={{ __html: html }} />
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code style="background:#24243a;padding:1px 5px;border-radius:4px;font-size:12px">$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b style="color:#fff">$1</b>').replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<i>$2</i>')
function mdToHtml(src) {
  const out = []
  let list = null
  const close = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    let m
    if (!line.trim()) { close(); continue }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul style="margin:6px 0;padding-left:20px">'); list = 'ul' } out.push(`<li>${inline(m[1])}</li>`); continue }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol style="margin:6px 0;padding-left:20px">'); list = 'ol' } out.push(`<li>${inline(m[1])}</li>`); continue }
    close()
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { out.push(`<div style="font-weight:800;color:#fff;margin:10px 0 4px">${inline(m[1])}</div>`); continue }
    if ((m = line.match(/^>\s?(.*)/))) { out.push(`<div style="border-left:3px solid #7c4dff;padding:2px 10px;margin:6px 0;color:#cfc8ff">${inline(m[1])}</div>`); continue }
    if (/^\|.*\|$/.test(line)) { if (/^\|[\s:-|]+\|$/.test(line)) continue; out.push(`<div style="font-family:monospace;font-size:12px;white-space:pre">${esc(line)}</div>`); continue }
    out.push(`<p style="margin:6px 0">${inline(line)}</p>`)
  }
  close()
  return out.join('')
}

const nice = s => String(s || '').replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
const fmtEffect = v => v == null ? '—' : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(' · ') : String(v)
const fmtDur = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`

const bar = {
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 24px',
  background: '#16161f', borderBottom: '1px solid #2a2a3e', position: 'sticky', top: 0, zIndex: 5,
}
const card = { background: '#16161f', border: '1px solid #2a2a3e', borderRadius: 12, padding: 16, marginBottom: 12 }
const label = { display: 'block', fontSize: 12, color: '#9a9ab0', fontWeight: 700, margin: '14px 0 6px' }
const input = { width: '100%', background: '#1e1e2e', border: '1px solid #444', borderRadius: 8, color: '#fff', padding: '10px 12px', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
const code = { background: '#24243a', borderRadius: 4, padding: '1px 5px', fontSize: 12, color: '#cfc8ff' }
const btn = (bg) => ({
  background: bg, border: 'none', borderRadius: 6, color: '#fff', padding: '6px 14px',
  cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
})
