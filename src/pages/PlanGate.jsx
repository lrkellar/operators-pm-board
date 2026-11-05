import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { handBackReview } from '../utils/plannerApi'
import GanttChart from '../components/GanttChart'
import { LEVEL_NAMES, LEVEL_STATUS, MARKS, currentRevision } from '../utils/councilPlans'

const LOOK_FOR = [
  ['Is the goal worth doing?', 'Can you actually run the success test?', 'Does "out of scope" rule out the right things?', 'Do the rough hours and money fit your life?'],
  ['Does each phase test its riskiest part first?', 'Are the alternatives real options?', 'Is there a cheap check before any big spend?', 'Are the safety tests inside the gates, not at the end?'],
  ['Do the packages fit your weekly hours and the cash ceiling?', 'Is any package too big to manage?', 'Are paid hours and waits visible?', 'Does Stage 1 end by the deadline?'],
  ['Does the order work on the bench?', 'Are the hand-offs and waits real?', 'Is every pass/fail line written before its test?'],
  ['Could you start Monday from this list?', 'Does the first week read right?', 'Are safety holds shown as waits?'],
]
const SEV = {
  blocking: { color: '#F44336', label: 'Blocking' },
  major:    { color: '#FF9800', label: 'Major' },
  minor:    { color: '#9E9E9E', label: 'Minor' },
  watch:    { color: '#64B5F6', label: 'Watch' },
}
const SEV_ORDER = ['blocking', 'major', 'minor', 'watch']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = d => (d ? `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}` : '—')
const num = (v, dp = 1) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }))
const money = v => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`)

export default function PlanGate({ planId, level, onBack, backLabel }) {
  const council         = useStore(s => s.council)
  const saveLevelReview = useStore(s => s.saveLevelReview)
  const promoteLevel    = useStore(s => s.promoteLevel)
  const plan     = council.plans?.[planId]
  const levelObj = plan?.levels?.[String(level)]
  const rev      = currentRevision(levelObj)
  const payload  = rev?.payload
  const prior    = rev?.review ?? {}

  const [scenario, setScenario] = useState(payload?.scenarios?.[0] ?? 'bootstrap')
  const [marks, setMarks]       = useState(prior.marks ?? {})
  const [crs, setCrs]           = useState(prior.cr_decisions ?? {})
  const [decs, setDecs]         = useState(prior.decisions ?? {})
  const [comment, setComment]   = useState(prior.comment ?? '')
  const [selected, setSelected] = useState(null)
  const [view, setView]         = useState('tree')
  const [filter, setFilter]     = useState('all')
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState('')
  const [err, setErr]           = useState('')
  const [dirty, setDirty]       = useState(false)

  const items = useMemo(() => payload?.items ?? [], [payload])
  const byId  = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const generalFlags = (payload?.flags ?? []).filter(f => !byId[f.id] && !(payload?.parents ?? []).some(p => p.id === f.id))

  if (!payload) return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', color: '#fff', padding: 24 }}>
      <button onClick={onBack} style={btn('#333')}>← Back</button>
      <p style={{ marginTop: 24, color: '#aaa' }}>This level has no published content on the board.</p>
    </div>
  )

  const status = LEVEL_STATUS[levelObj.status] ?? LEVEL_STATUS.drafting
  const totals = payload.totals?.[scenario] ?? {}
  const counts = payload.counts ?? {}
  const markOf = id => marks[id]?.mark
  const tally = { approve: 0, change: 0, question: 0, unmarked: 0 }
  items.forEach(i => { tally[markOf(i.id) ?? 'unmarked'] += 1 })
  const diffs = { new: items.filter(i => i.diff === 'new').length, changed: items.filter(i => i.diff === 'changed').length }
  const missingComment = Object.entries(marks).filter(([, m]) => m.mark !== 'approve' && !(m.comment ?? '').trim()).map(([id]) => id)

  const visible = i => {
    if (!(i.scenarios ?? []).includes(scenario)) return false
    if (filter === 'flagged') return (i.flags ?? []).length > 0
    if (filter === 'unmarked') return !markOf(i.id)
    if (filter === 'changed') return payload.revision > 1 && i.diff !== 'same'
    return true
  }

  const setMark = (id, mark) => {
    setDirty(true)
    setMarks(m => {
      const cur = m[id]
      if (cur?.mark === mark) { const { [id]: _drop, ...rest } = m; return rest }
      return { ...m, [id]: { mark, comment: cur?.comment ?? '', at: new Date().toISOString() } }
    })
  }
  const setItemComment = (id, text) => {
    setDirty(true)
    setMarks(m => ({ ...m, [id]: { mark: m[id]?.mark ?? 'question', comment: text, at: new Date().toISOString() } }))
  }
  const approveUnmarked = () => {
    setDirty(true)
    setMarks(m => {
      const next = { ...m }
      items.filter(i => (i.scenarios ?? []).length && !next[i.id]).forEach(i => { next[i.id] = { mark: 'approve', comment: '', at: new Date().toISOString() } })
      return next
    })
  }

  const save = async (decision) => {
    setErr(''); setMsg('')
    if (decision && missingComment.length) { setErr(`Add a comment to ${missingComment.join(', ')} so the planners know what to change.`); return }
    if (decision === 'changes_requested' && !comment.trim() && !tally.change && !tally.question) {
      setErr('Say what needs to change: mark items Change or Question, or write an overall comment.'); return
    }
    setBusy(true)
    try {
      const review = { decision: decision ?? null, comment, marks, cr_decisions: crs, decisions: decs, decided_at: decision ? new Date().toISOString() : null }
      const st = decision === 'approved' ? 'approved' : decision === 'changes_requested' ? 'changes_requested' : levelObj.status
      await saveLevelReview(planId, level, rev.revision, review, st)
      setDirty(false)
      // A guided plan's council runs on this PC: hand the review straight to it.
      const hb = decision ? await handBackReview(planId, level, rev.revision, review) : null
      const handed = hb?.started ? ' Sent to the council on your PC; it has started.' : hb && !hb.sent ? ` (Could not reach the planner: ${hb.error})` : ''
      setMsg((decision === 'approved' ? 'Level approved. The council will lock it and start the next level.'
        : decision === 'changes_requested' ? 'Sent back. The council will revise and publish a new revision.'
          : 'Review saved. You can come back and finish it later.') + handed)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const promote = async () => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const r = await promoteLevel(planId, level, scenario)
      setMsg(`Added ${r.count} items to the board as project "${plan.name} (${scenario})".`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const decisions = payload.decisions ?? []
  const chosenHere = id => decs[id]?.choice && decs[id].choice !== 'test'
  const resolvedByChoice = f => (f.code === 'decision_due' && chosenHere(f.id))
    || (f.code === 'depends_open_decision' && (f.message.match(/D-\d+/) ?? []).some(chosenHere))
  const blocking = (payload.flags ?? []).filter(f => f.severity === 'blocking' && !resolvedByChoice(f)).length
  const openDecisions = decisions.filter(d => d.status !== 'decided' && !chosenHere(d.id)).length
  const decTitle = Object.fromEntries(decisions.map(d => [d.id, d]))
  const canApprove = !blocking && !tally.change && !busy
  const sel = selected ? (byId[selected] ?? (payload.parents ?? []).find(p => p.id === selected)) : null

  // groups: approved parents with their new children underneath
  const parents = payload.parents ?? []
  const groups = parents.length
    ? parents.map(p => ({ parent: p, children: items.filter(i => i.parent === p.id) }))
    : [{ parent: null, children: items }]
  const orphans = parents.length ? items.filter(i => !parents.some(p => p.id === i.parent)) : []
  if (orphans.length) groups.push({ parent: { id: '—', title: 'Items with no parent on this page', rollup: {}, flags: [] }, children: orphans })

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f17', color: '#fff' }}>
      {/* top bar */}
      <div style={bar}>
        <button onClick={onBack} style={btn('#333')}>{backLabel ?? '← Plans'}</button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{plan.name} · L{level} {LEVEL_NAMES[level]}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Revision {rev.revision} · published {new Date(rev.published_at).toLocaleString()} ·{' '}
            <span style={{ color: status.color, fontWeight: 700 }}>{status.label}</span>
          </div>
        </div>
        <label style={{ fontSize: 12, color: '#aaa', display: 'flex', alignItems: 'center', gap: 6 }}>
          Plan
          <select value={scenario} onChange={e => setScenario(e.target.value)} style={select}>
            {payload.scenarios.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={() => save(null)} disabled={busy} style={btn('#2a2a3e')}>{dirty ? 'Save draft •' : 'Save draft'}</button>
      </div>

      <div style={{ padding: '18px 24px 120px', maxWidth: 1500, margin: '0 auto' }}>
        {/* gate question */}
        <div style={{ ...panel, borderColor: '#7c4dff', marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#b39dff', fontWeight: 700, letterSpacing: 0.4 }}>GATE QUESTION</div>
          <div style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 8px' }}>{payload.gate_question}</div>
          <div style={{ fontSize: 13, color: '#aaa', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {LOOK_FOR[level].map(q => <span key={q}>• {q}</span>)}
          </div>
        </div>

        {/* summary tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
          <Tile label="Items in this level" value={items.filter(i => (i.scenarios ?? []).includes(scenario)).length}
            sub={payload.revision > 1 ? `${diffs.new} new · ${diffs.changed} changed · ${(payload.removed ?? []).length} removed` : 'first revision'} />
          <Tile label="Stage 1 owner hours" value={num(totals.stage1_effort_h)}
            sub={totals.stage1_owner_cap ? `cap ${num(totals.stage1_owner_cap, 0)} h` : `all stages ${num(totals.effort_h)} h`}
            color={totals.stage1_owner_cap && totals.stage1_effort_h > totals.stage1_owner_cap ? '#F44336' : '#fff'} />
          <Tile label="Cash" value={money(totals.cash_usd)} sub={totals.cash_ceiling ? `ceiling ${money(totals.cash_ceiling)}` : ''}
            color={totals.cash_ceiling && totals.cash_usd > totals.cash_ceiling ? '#F44336' : '#fff'} />
          <Tile label="Stage 1 ends" value={day(totals.stage1_finish)}
            sub={totals.deadline ? `deadline ${day(totals.deadline)}` : ''}
            color={totals.deadline && totals.stage1_finish && totals.stage1_finish > totals.deadline ? '#F44336' : '#fff'} />
          <Tile label="Flags" value={SEV_ORDER.map(s => counts[s] ?? 0).join(' / ')} sub="blocking / major / minor / watch"
            color={blocking ? '#F44336' : counts.major ? '#FF9800' : '#4CAF50'} />
          <Tile label="Your marks" value={`${tally.approve} ✓ · ${tally.change} ✎ · ${tally.question} ?`} sub={`${tally.unmarked} not marked yet`} />
          {decisions.length > 0 && (
            <Tile label="Plan decisions" value={`${decisions.length - openDecisions} of ${decisions.length}`}
              sub={openDecisions ? `${openDecisions} still open` : 'all settled'} color={openDecisions ? '#FF9800' : '#4CAF50'} />
          )}
        </div>

        {payload.charter && <Charter charter={payload.charter} />}

        {decisions.length > 0 && (
          <div style={{ ...panel, marginBottom: 14 }}>
            <div style={h3}>Plan decisions</div>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 10, lineHeight: 1.5 }}>
              The choices this level is built on. Choices you made with the panel in the conversation are shown; confirm them,
              or pick another option. Changing a decided choice marks every item that relied on it as stale.
            </div>
            {decisions.map(d => (
              <DecisionCard key={d.id} d={d} pick={decs[d.id]} scenario={scenario}
                onPick={choice => { setDirty(true); setDecs(m => ({ ...m, [d.id]: { ...(m[d.id] ?? {}), choice: m[d.id]?.choice === choice ? undefined : choice } })) }}
                onComment={text => { setDirty(true); setDecs(m => ({ ...m, [d.id]: { ...(m[d.id] ?? {}), comment: text } })) }} />
            ))}
          </div>
        )}

        {(payload.change_requests ?? []).length > 0 && (
          <div style={{ ...panel, marginBottom: 14 }}>
            <div style={h3}>Change requests to approved items</div>
            {payload.change_requests.map(cr => (
              <div key={cr.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid #2a2a3e', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260, fontSize: 13, lineHeight: 1.5 }}>
                  <b>{cr.id}</b> on <b>{cr.target}</b>: {cr.change}
                  <div style={{ color: '#999' }}>Why: {cr.reason}{cr.effect ? ` · Effect: ${Object.entries(cr.effect).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}` : ''}</div>
                </div>
                {['approve', 'reject'].map(d => (
                  <button key={d} onClick={() => { setDirty(true); setCrs(c => ({ ...c, [cr.id]: c[cr.id] === d ? undefined : d })) }}
                    style={{ ...btn(crs[cr.id] === d ? (d === 'approve' ? '#2e7d32' : '#c62828') : '#2a2a3e'), textTransform: 'capitalize' }}>{d}</button>
                ))}
              </div>
            ))}
          </div>
        )}

        {generalFlags.length > 0 && (
          <div style={{ ...panel, marginBottom: 14 }}>
            <div style={h3}>Level checks</div>
            {generalFlags.map((f, i) => <Flag key={i} f={f} />)}
          </div>
        )}

        {/* view controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          {['tree', 'timeline'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ ...btn(view === v ? '#7c4dff' : '#2a2a3e'), textTransform: 'capitalize' }}>{v}</button>
          ))}
          <span style={{ width: 12 }} />
          {[['all', 'All'], ['flagged', 'Flagged'], ['unmarked', 'Not marked'], ['changed', 'Changed']].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ ...chip, borderColor: filter === k ? '#7c4dff' : '#333', color: filter === k ? '#fff' : '#aaa' }}>{label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={approveUnmarked} style={btn('#2a2a3e')} title="Mark every item you have not marked as Approve">✓ Approve all unmarked</button>
        </div>

        {(payload.removed ?? []).length > 0 && (
          <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>Removed since the last revision: {payload.removed.join(', ')}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 14, alignItems: 'start' }} className="gate-grid">
          {/* left: tree or timeline */}
          <div style={{ ...panel, padding: 0, overflow: 'hidden' }}>
            {view === 'timeline' ? (
              <div style={{ padding: 8 }}>
                <GanttChart tasks={items.filter(visible).filter(i => i.dates?.[scenario]).map(i => ({
                  task_id: i.id, task_name: `${i.id} ${i.title}`, start_date: i.dates[scenario].start, end_date: i.dates[scenario].finish,
                  status: markOf(i.id) === 'approve' ? 'complete' : markOf(i.id) === 'change' ? 'overdue' : markOf(i.id) === 'question' ? 'at_risk' : 'not_started',
                  progress: markOf(i.id) === 'approve' ? 100 : 0, type: 'task', assignee: i.owner_seat ?? '',
                }))} />
                <div style={{ fontSize: 11, color: '#777', padding: '8px 6px' }}>
                  Bar colour follows your mark: green approved, red change, orange question, grey not marked.
                  {level <= 1 && ' At this level the dates are rough bands from each item\'s likely length.'}
                </div>
              </div>
            ) : groups.map(g => {
              const kids = g.children.filter(visible)
              if (g.parent && !kids.length && filter !== 'all') return null
              return (
                <div key={g.parent?.id ?? 'root'} style={{ borderBottom: '1px solid #2a2a3e' }}>
                  {g.parent && <ParentRow p={g.parent} scenario={scenario} level={level} selected={selected === g.parent.id} onClick={() => setSelected(g.parent.id)} />}
                  {kids.length === 0 && g.parent && (
                    <div style={{ padding: '8px 16px 10px 40px', fontSize: 12, color: '#F44336' }}>No items under this yet.</div>
                  )}
                  {kids.map(i => (
                    <ItemRow key={i.id} i={i} scenario={scenario} level={level} mark={markOf(i.id)} showDiff={payload.revision > 1}
                      selected={selected === i.id} onClick={() => setSelected(i.id)} indent={!!g.parent} />
                  ))}
                </div>
              )
            })}
          </div>

          {/* right: item panel */}
          <div style={{ ...panel, position: 'sticky', top: 76, maxHeight: 'calc(100vh - 96px)', overflowY: 'auto' }}>
            {!sel ? (
              <div style={{ color: '#aaa', fontSize: 13, lineHeight: 1.6 }}>
                <div style={h3}>How to review</div>
                Select an item to see everything about it. Mark it <b style={{ color: MARKS.approve.color }}>Approve</b>,{' '}
                <b style={{ color: MARKS.change.color }}>Change</b> (say what) or <b style={{ color: MARKS.question.color }}>Question</b>.
                Group rows show the approved item above and a bar comparing its new items' total with its range.
                When you are done, approve the level or send it back below.
              </div>
            ) : (
              <ItemPanel item={sel} isParent={!byId[sel.id]} scenarios={payload.scenarios} level={level} decTitle={decTitle}
                mark={marks[sel.id]} onMark={m => setMark(sel.id, m)} onComment={t => setItemComment(sel.id, t)} />
            )}
          </div>
        </div>
      </div>

      {/* decision bar */}
      <div style={decisionBar}>
        <textarea value={comment} onChange={e => { setComment(e.target.value); setDirty(true) }}
          placeholder="Overall comment for the planners (required to send back without marks)"
          style={{ ...input, flex: 1, minWidth: 240, height: 44, resize: 'vertical' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => save('changes_requested')} disabled={busy} style={btn('#e65100')}>Send back</button>
            <button onClick={() => save('approved')} disabled={!canApprove} style={{ ...btn('#2e7d32'), opacity: canApprove ? 1 : 0.45 }}
              title={blocking ? 'Blocking flags must be fixed first: send it back' : tally.change ? 'Some items are marked Change: send it back, or clear those marks' : 'Approve and lock this level'}>
              Approve level
            </button>
            {levelObj.status === 'approved' && level >= 2 && (
              <button onClick={promote} disabled={busy} style={btn('#7c4dff')} title="Add this level's dated items to the board as a live project">
                Put on board ({scenario})
              </button>
            )}
          </div>
          <div style={{ fontSize: 11, color: err ? '#F44336' : msg ? '#4CAF50' : '#888', maxWidth: 520, textAlign: 'right' }}>
            {err || msg || (blocking ? `${blocking} blocking flag${blocking > 1 ? 's' : ''}: this level can only be sent back.` : 'Unmarked items count as approved when you approve the level.')}
          </div>
        </div>
      </div>
      <style>{'@media (max-width: 980px) { .gate-grid { grid-template-columns: 1fr !important; } }'}</style>
    </div>
  )
}

function Tile({ label, value, sub, color = '#fff' }) {
  return (
    <div style={{ background: '#16161f', border: '1px solid #2a2a3e', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, margin: '2px 0' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#777' }}>{sub}</div>
    </div>
  )
}

function Charter({ charter }) {
  const list = v => (Array.isArray(v) ? v.map(x => (typeof x === 'object' ? (x.q ? `${x.q} (${x.phase})` : x.role ? `${x.role}: ${(x.phases ?? []).join(', ')}` : JSON.stringify(x)) : x)) : [typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(', ') : x}`).join(' · ') : v])
  const rows = [['Goal', charter.goal], ['Success test', charter.success_test], ['In scope', charter.in_scope], ['Out of scope', charter.out_of_scope],
    ['Constraints', charter.constraints], ['Unknowns', charter.unknowns], ['Stage split', charter.stage_split], ['Experts needed', charter.roles_needed]]
  return (
    <div style={{ ...panel, marginBottom: 14 }}>
      <div style={h3}>Charter</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '10px 24px' }}>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 11, color: '#888', fontWeight: 700 }}>{k}</div>
            {list(v).map((x, i) => <div key={i} style={{ fontSize: 13, color: '#ddd', lineHeight: 1.5 }}>{list(v).length > 1 ? '• ' : ''}{x}</div>)}
          </div>
        ))}
      </div>
    </div>
  )
}

function rangeText(r, level, money_) {
  if (!r) return '—'
  if (money_) return r[0] === r[2] ? money(r[1]) : `${money(r[1])} (${money(r[0])}–${money(r[2])})`
  if (level === 4) return `${Math.round(r[1] * 60)} min`
  return r[0] === r[2] ? `${num(r[1])} h` : `${num(r[1])} h (${num(r[0])}–${num(r[2])})`
}

function ParentRow({ p, scenario, level, selected, onClick }) {
  const ru = p.rollup?.[scenario]
  const worst = (p.flags ?? []).map(f => f.severity).sort((a, b) => SEV_ORDER.indexOf(a) - SEV_ORDER.indexOf(b))[0]
  return (
    <div onClick={onClick} style={{ padding: '10px 14px', background: selected ? '#262640' : '#1b1b29', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        {(p.path ?? []).length > 0 && (
          <div style={{ fontSize: 11, color: '#777' }}>{p.path.map(a => `${a.id} ${a.title}`).join('  ›  ')}</div>
        )}
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          <span style={{ color: '#b39dff', marginRight: 6 }}>{p.id}</span>{p.title}
          <span style={{ fontSize: 10, color: '#4CAF50', marginLeft: 8, fontWeight: 600 }}>APPROVED · L{level - 1}</span>
          {worst && <span style={{ color: SEV[worst].color, marginLeft: 8, fontSize: 11 }}>● {SEV[worst].label}</span>}
        </div>
      </div>
      {ru?.effort_h && <RollupBar r={ru.effort_h} unit="h" level={level} />}
      {ru?.cash_usd && <RollupBar r={ru.cash_usd} unit="$" level={level} />}
    </div>
  )
}

function RollupBar({ r, unit }) {
  const W = 150
  const max = Math.max(r.high, r.children, 0.0001) * 1.15
  const x = v => (v / max) * W
  const color = r.status === 'out' ? '#F44336' : r.status === 'watch' ? '#FF9800' : '#4CAF50'
  const f = v => (unit === '$' ? money(v) : `${num(v)} h`)
  return (
    <div title={`New items total ${f(r.children)}; approved range ${f(r.low)}–${f(r.high)} (likely ${f(r.likely)})`} style={{ width: W + 8 }}>
      <svg width={W + 8} height={16} style={{ display: 'block' }}>
        <rect x={4} y={5} width={W} height={6} rx={3} fill="#2a2a3e" />
        <rect x={4 + x(r.low)} y={3} width={Math.max(x(r.high) - x(r.low), 2)} height={10} rx={3} fill="#3d3d5c" />
        <line x1={4 + x(r.likely)} x2={4 + x(r.likely)} y1={2} y2={14} stroke="#888" strokeWidth={1} />
        <circle cx={4 + x(r.children)} cy={8} r={4.5} fill={color} />
      </svg>
      <div style={{ fontSize: 10, color: '#999', textAlign: 'center' }}>
        <span style={{ color }}>{f(r.children)}</span> of {f(r.low)}–{f(r.high)}
      </div>
    </div>
  )
}

function ItemRow({ i, scenario, level, mark, showDiff, selected, onClick, indent }) {
  const worst = (i.flags ?? []).map(f => f.severity).sort((a, b) => SEV_ORDER.indexOf(a) - SEV_ORDER.indexOf(b))[0]
  const d = i.dates?.[scenario]
  return (
    <div onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr) 150px 120px 110px', gap: 10, alignItems: 'center',
      padding: `8px 14px 8px ${indent ? 32 : 14}px`, cursor: 'pointer', borderTop: '1px solid #20202e',
      background: selected ? '#26263a' : 'transparent', fontSize: 13,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: mark ? MARKS[mark].color : 'transparent', border: `1px solid ${mark ? MARKS[mark].color : '#555'}` }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: '#888', marginRight: 6 }}>{i.id}</span>{i.title}
        </div>
        <div style={{ fontSize: 11, color: '#777', display: 'flex', gap: 8 }}>
          {i.owner_seat && <span>{i.owner_seat}</span>}
          {showDiff && i.diff !== 'same' && <span style={{ color: i.diff === 'new' ? '#64B5F6' : '#FFB74D', fontWeight: 700 }}>{i.diff.toUpperCase()}</span>}
          {worst && <span style={{ color: SEV[worst].color }}>● {SEV[worst].label}</span>}
          {i.prior_review?.comment && <span style={{ color: '#b39dff' }}>✎ earlier comment</span>}
          {i.kind === 'wait' && <span>wait</span>}
          {i.stale && <span style={{ color: '#F44336', fontWeight: 700 }}>STALE ({i.stale.decision})</span>}
          {i.decides && <span style={{ color: '#64B5F6' }}>tests {i.decides}</span>}
          {(i.depends_on ?? []).length > 0 && <span style={{ color: '#8a7fc0' }}>{i.depends_on.join(' ')}</span>}
        </div>
      </div>
      <div style={{ color: '#ccc', fontSize: 12 }}>{rangeText(i.effort_h?.[scenario], level)}</div>
      <div style={{ color: '#ccc', fontSize: 12 }}>{rangeText(i.cash_usd?.[scenario], level, true)}</div>
      <div style={{ color: d?.critical ? '#FFB74D' : '#999', fontSize: 12 }} title={d?.critical ? 'On the critical path' : ''}>
        {d ? `${day(d.start)} – ${day(d.finish)}` : ''}
      </div>
    </div>
  )
}

function ItemPanel({ item, isParent, scenarios, level, mark, onMark, onComment, decTitle = {} }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 700 }}>{item.id} · {item.kind}{isParent ? ` · approved at L${level - 1}` : ''}</div>
      <div style={{ fontSize: 17, fontWeight: 800, margin: '2px 0 6px' }}>{item.title}</div>
      {item.summary && <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5, marginBottom: 10 }}>{item.summary}</div>}

      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 10 }}>
        <thead><tr style={{ color: '#888' }}><td></td><td>Owner hours</td><td>Cash</td></tr></thead>
        <tbody>
          {scenarios.map(s => (
            <tr key={s} style={{ borderTop: '1px solid #2a2a3e', color: (item.scenarios ?? scenarios).includes(s) ? '#ddd' : '#555' }}>
              <td style={{ padding: '4px 0', textTransform: 'capitalize' }}>{s}</td>
              <td>{rangeText(item.effort_h?.[s], isParent ? level - 1 : level)}</td>
              <td>{rangeText(item.cash_usd?.[s], level, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {item.stale && (
        <div style={{ background: '#3a1d1d', border: '1px solid #F44336', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 12, color: '#ffcdd2', lineHeight: 1.5 }}>
          <b>Stale:</b> decision {item.stale.decision} changed from {item.stale.was} to {item.stale.now}. The owner must rewrite this for the new choice.
        </div>
      )}
      {(item.depends_on ?? []).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#888', fontWeight: 700 }}>Built on these decisions</div>
          {item.depends_on.map(id => {
            const d = decTitle[id]
            const opt = d?.options?.find(o => o.id === d?.choice?.option)
            return (
              <div key={id} style={{ fontSize: 13, color: '#ddd', lineHeight: 1.45 }}>
                • <b style={{ color: '#b39dff' }}>{id}</b> {d?.title ?? ''}{' '}
                <span style={{ color: d?.status === 'decided' ? '#4CAF50' : '#FF9800' }}>
                  {d?.status === 'decided' ? `→ ${opt ? `${opt.id}: ${opt.title}` : d.choice?.option}` : `(${d?.status ?? 'unknown'})`}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {item.decides && <div style={{ fontSize: 12, color: '#64B5F6', marginBottom: 10 }}>This is the test that settles {item.decides}.</div>}
      {(item.flags ?? []).length > 0 && <div style={{ marginBottom: 10 }}>{item.flags.map((f, i) => <Flag key={i} f={f} />)}</div>}

      {(item.fields ?? []).map(f => (
        <div key={f.label} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#888', fontWeight: 700 }}>{f.label}</div>
          {Array.isArray(f.value)
            ? f.value.map((v, i) => <div key={i} style={{ fontSize: 13, color: '#ddd', lineHeight: 1.45 }}>• {v}</div>)
            : <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.45 }}>{f.value}</div>}
        </div>
      ))}

      {item.prior_review?.comment && (
        <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 10, margin: '10px 0', fontSize: 12, color: '#ccc' }}>
          <b style={{ color: '#b39dff' }}>Your earlier comment ({item.prior_review.mark}):</b> {item.prior_review.comment}
        </div>
      )}

      {!isParent && (
        <div style={{ borderTop: '1px solid #2a2a3e', paddingTop: 10, marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {Object.entries(MARKS).map(([k, m]) => (
              <button key={k} onClick={() => onMark(k)} style={{
                ...btn(mark?.mark === k ? m.color : '#2a2a3e'), flex: 1, justifyContent: 'center',
                border: `1px solid ${m.color}`,
              }}>{m.label}</button>
            ))}
          </div>
          <textarea value={mark?.comment ?? ''} onChange={e => onComment(e.target.value)}
            placeholder={mark?.mark === 'change' ? 'What should change? (required)' : 'Comment or question for the planner'}
            style={{ ...input, width: '100%', height: 70, resize: 'vertical' }} />
        </div>
      )}
    </div>
  )
}

function DecisionCard({ d, pick, onPick, onComment, scenario }) {
  const recorded = d.status === 'decided' ? d.choice?.option : null
  const current = pick?.choice ?? recorded
  const changing = recorded && pick?.choice && pick.choice !== recorded
  const impact = d.impact?.levels ?? {}
  const total = Object.values(impact).reduce((n, v) => n + v.count, 0)
  const statusText = d.status === 'decided' ? `Decided${d.choice?.via ? ` in the ${d.choice.via}` : ''}` : d.status === 'testing' ? 'Being tested' : d.status === 'revisited' ? 'Revisited' : 'Open'
  const statusColor = d.status === 'decided' ? '#4CAF50' : d.status === 'testing' ? '#64B5F6' : '#FF9800'
  const fmtEffect = (k, v) => {
    if (k === 'weight_lb') return `weight ${v} lb`
    if (k === 'unit_cost_usd') return `unit cost $${v}`
    if (k.endsWith('_usd')) return `${k.replace(/_usd$/, '').replace(/_/g, ' ')} $${v}`
    if (k === 'plan_owner_h') return `plan hours ${v > 0 ? '+' : ''}${v}`
    if (k.endsWith('_h')) return `${k.replace(/_h$/, '').replace(/_/g, ' ')} ${v} h`
    return `${k.replace(/_/g, ' ')} ${v}`
  }
  return (
    <div style={{ border: '1px solid #2a2a3e', borderRadius: 10, padding: 14, marginBottom: 12, background: '#1a1a26' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ color: '#b39dff', fontWeight: 800 }}>{d.id}</span>
        <span style={{ fontWeight: 700, fontSize: 15, flex: 1, minWidth: 200 }}>{d.title}</span>
        {d.due_here && <span style={{ fontSize: 11, color: '#FFB74D', fontWeight: 700 }}>DUE AT THIS LEVEL</span>}
        <span style={{ fontSize: 12, color: statusColor, fontWeight: 700 }}>{statusText}{recorded ? `: ${recorded}` : ''}</span>
      </div>
      <div style={{ fontSize: 13, color: '#ccc', margin: '6px 0 2px', lineHeight: 1.5 }}>{d.question}</div>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 10, lineHeight: 1.5 }}>{d.why_it_matters}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {(d.options ?? []).map(o => {
          const sel = current === o.id
          const rec = d.recommendation?.option === o.id
          const fx = o.effects ? Object.entries(o.effects).filter(([, v]) => typeof v !== 'object') : []
          return (
            <button key={o.id} onClick={() => onPick(o.id)} style={{
              textAlign: 'left', background: sel ? '#1f3324' : '#16161f', color: '#fff', cursor: 'pointer',
              border: `${sel ? 2 : 1}px solid ${sel ? '#4CAF50' : '#333'}`, borderRadius: 8, padding: 10, fontFamily: 'inherit',
            }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {o.id}. {o.title}
                {rec && <span style={{ fontSize: 10, color: '#b39dff', marginLeft: 6 }}>RECOMMENDED</span>}
                {recorded === o.id && <span style={{ fontSize: 10, color: '#4CAF50', marginLeft: 6 }}>CHOSEN</span>}
              </div>
              {o.summary && <div style={{ fontSize: 12, color: '#bbb', margin: '4px 0', lineHeight: 1.4 }}>{o.summary}</div>}
              {(o.pros ?? []).map((x, k) => <div key={`p${k}`} style={{ fontSize: 12, color: '#81C784' }}>+ {x}</div>)}
              {(o.cons ?? []).map((x, k) => <div key={`c${k}`} style={{ fontSize: 12, color: '#E57373' }}>– {x}</div>)}
              {fx.length > 0 && <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{fx.map(([k, v]) => fmtEffect(k, v)).join(' · ')}</div>}
            </button>
          )
        })}
      </div>

      {(d.takes ?? []).length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: '#888', fontWeight: 700 }}>What the panel says</div>
          {d.takes.map(t => (
            <div key={t.seat} style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>
              • <b>{t.seat}</b>{t.leans ? ` leans ${t.leans}` : ''}{t.why ? `: ${t.why}` : ''}
            </div>
          ))}
          {d.recommendation && (
            <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>
              • <b>{d.recommendation.by}</b> (lead) recommends {d.recommendation.option}: {d.recommendation.why}
            </div>
          )}
        </div>
      )}

      {d.choice?.reason && <div style={{ fontSize: 12, color: '#aaa', marginTop: 8 }}>Your reason: {d.choice.reason}</div>}

      <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
        {total ? `${total} plan items rely on this: ${Object.entries(impact).map(([n, v]) => `L${n} ${v.count}${v.effort_h?.[scenario] ? ` (${v.effort_h[scenario]} h)` : ''}`).join(' · ')}` : 'No plan items rely on this yet.'}
      </div>
      {changing && (
        <div style={{ fontSize: 12, color: '#FFB74D', marginTop: 6 }}>
          Changing {recorded} to {pick.choice} marks those {total} items stale; their owners rewrite them in the next round.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {d.test && (
          <button onClick={() => onPick('test')} style={{ ...btn(pick?.choice === 'test' ? '#1565c0' : '#2a2a3e'), border: '1px solid #64B5F6' }}
            title={d.test.description}>Test first{d.test.owner_h ? ` (~${d.test.owner_h} h${d.test.cash_usd ? `, $${d.test.cash_usd}` : ''})` : ''}</button>
        )}
        <input value={pick?.comment ?? ''} onChange={e => onComment(e.target.value)}
          placeholder="Why this choice? (optional, the panel reads it)"
          style={{ ...input, flex: 1, minWidth: 220 }} />
      </div>
      {(d.flags ?? []).length > 0 && <div style={{ marginTop: 8 }}>{d.flags.map((f, k) => <Flag key={k} f={f} />)}</div>}
    </div>
  )
}

function Flag({ f }) {
  const s = SEV[f.severity] ?? SEV.minor
  return (
    <div style={{ fontSize: 12, color: '#ddd', lineHeight: 1.45, padding: '3px 0', display: 'flex', gap: 6 }}>
      <span style={{ color: s.color, fontWeight: 700, minWidth: 58 }}>{s.label}</span><span>{f.message}</span>
    </div>
  )
}

const bar = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 24px',
  background: '#16161f', borderBottom: '1px solid #2a2a3e', position: 'sticky', top: 0, zIndex: 6,
}
const decisionBar = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 6, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
  padding: '10px 24px', background: '#16161f', borderTop: '1px solid #2a2a3e',
}
const panel = { background: '#16161f', border: '1px solid #2a2a3e', borderRadius: 12, padding: 16 }
const h3 = { fontSize: 13, fontWeight: 800, marginBottom: 8, color: '#fff' }
const chip = { background: 'transparent', border: '1px solid #333', borderRadius: 14, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }
const select = { background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 13, textTransform: 'capitalize' }
const input = { background: '#1e1e2e', border: '1px solid #444', borderRadius: 8, color: '#fff', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' }
const btn = (bg) => ({
  background: bg, border: 'none', borderRadius: 6, color: '#fff', padding: '6px 14px',
  cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4,
})
