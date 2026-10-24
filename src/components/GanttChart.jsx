import { useMemo, useRef, useState } from 'react'
import { STATUS_COLOR } from '../utils/projectUtils'

const ROW_H    = 36
const LABEL_W  = 180
const DAY_W    = 28
const HEADER_H = 48
const TODAY    = new Date()

function startOfDay(d) {
  const x = new Date(d); x.setHours(0,0,0,0); return x
}

function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}

function diffDays(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000)
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function GanttChart({ tasks }) {
  const [tooltip, setTooltip] = useState(null)
  const svgRef = useRef(null)

  const validTasks = useMemo(() =>
    tasks.filter(t => t.start_date && t.end_date), [tasks])

  const { minDate, maxDate, days } = useMemo(() => {
    if (!validTasks.length) return { minDate: TODAY, maxDate: TODAY, days: 0 }
    const starts = validTasks.map(t => startOfDay(new Date(t.start_date)))
    const ends   = validTasks.map(t => startOfDay(new Date(t.end_date)))
    const min    = new Date(Math.min(...starts))
    const max    = new Date(Math.max(...ends))
    min.setDate(min.getDate() - 3)
    max.setDate(max.getDate() + 5)
    return { minDate: min, maxDate: max, days: diffDays(min, max) }
  }, [validTasks])

  const totalW = LABEL_W + days * DAY_W
  const totalH = HEADER_H + validTasks.length * ROW_H

  // build month header segments
  const monthSegs = useMemo(() => {
    const segs = []; let cur = new Date(minDate)
    while (cur < maxDate) {
      const start = new Date(cur)
      const end   = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      const clamp = end > maxDate ? maxDate : end
      segs.push({ label: `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`, startDay: diffDays(minDate, start), spanDays: diffDays(start, clamp) })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
    return segs
  }, [minDate, maxDate])

  if (!validTasks.length) return (
    <div style={{ color: '#555', padding: 24, textAlign: 'center' }}>No tasks with dates to display.</div>
  )

  const todayX = LABEL_W + diffDays(minDate, TODAY) * DAY_W

  return (
    <div style={{ overflowX: 'auto', overflowY: 'visible', position: 'relative' }}>
      <svg
        ref={svgRef}
        width={totalW}
        height={totalH}
        style={{ display: 'block', minWidth: totalW }}
      >
        {/* background */}
        <rect width={totalW} height={totalH} fill="#16161f" />

        {/* month headers */}
        {monthSegs.map((seg, i) => (
          <g key={i}>
            <rect
              x={LABEL_W + seg.startDay * DAY_W} y={0}
              width={seg.spanDays * DAY_W} height={HEADER_H / 2}
              fill={i % 2 === 0 ? '#1e1e2e' : '#1a1a28'}
              stroke="#2a2a3e" strokeWidth={0.5}
            />
            <text
              x={LABEL_W + seg.startDay * DAY_W + 6} y={14}
              fill="#888" fontSize={11} fontWeight={600}
            >{seg.label}</text>
          </g>
        ))}

        {/* week day ticks */}
        {Array.from({ length: days }, (_, i) => {
          const d = addDays(minDate, i)
          const isWeekend = d.getDay() === 0 || d.getDay() === 6
          const isMon = d.getDay() === 1
          const x = LABEL_W + i * DAY_W
          return (
            <g key={i}>
              <rect
                x={x} y={HEADER_H / 2}
                width={DAY_W} height={HEADER_H / 2}
                fill={isWeekend ? '#1a1a28' : '#16161f'}
                stroke="#2a2a3e" strokeWidth={0.5}
              />
              {isMon && (
                <text x={x + 3} y={HEADER_H - 6} fill="#555" fontSize={9}>{d.getDate()}</text>
              )}
              {/* vertical grid line */}
              <line
                x1={x} y1={HEADER_H} x2={x} y2={totalH}
                stroke={isWeekend ? '#1e1e2e' : '#2a2a3e'} strokeWidth={0.5}
              />
            </g>
          )
        })}

        {/* row backgrounds + task bars */}
        {validTasks.map((task, i) => {
          const y       = HEADER_H + i * ROW_H
          const color   = STATUS_COLOR[task.status] ?? '#9E9E9E'
          const startD  = startOfDay(new Date(task.start_date))
          const endD    = startOfDay(new Date(task.end_date))
          const barX    = LABEL_W + diffDays(minDate, startD) * DAY_W
          const barW    = Math.max(diffDays(startD, endD), 1) * DAY_W
          const prog    = Math.min(Math.max(parseFloat(task.progress) || 0, 0), 100)
          const isMile  = task.type === 'milestone'

          return (
            <g key={task.task_id}>
              {/* row bg */}
              <rect x={0} y={y} width={totalW} height={ROW_H}
                fill={i % 2 === 0 ? '#16161f' : '#13131c'} />

              {/* label */}
              <text x={8} y={y + ROW_H / 2 + 4}
                fill="#ccc" fontSize={12} clipPath={`url(#lclip-${i})`}>
                {task.task_name}
              </text>
              <clipPath id={`lclip-${i}`}>
                <rect x={0} y={y} width={LABEL_W - 8} height={ROW_H} />
              </clipPath>

              {/* separator */}
              <line x1={0} y1={y + ROW_H} x2={totalW} y2={y + ROW_H}
                stroke="#2a2a3e" strokeWidth={0.5} />

              {/* milestone diamond */}
              {isMile ? (
                <g transform={`translate(${barX}, ${y + ROW_H / 2})`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => setTooltip({ task, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}>
                  <polygon
                    points="0,-10 12,0 0,10 -12,0"
                    fill={color} stroke="#fff" strokeWidth={1}
                  />
                </g>
              ) : (
                <g style={{ cursor: 'pointer' }}
                  onMouseEnter={e => setTooltip({ task, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}>
                  {/* bar bg */}
                  <rect x={barX} y={y + 8} width={barW} height={ROW_H - 16}
                    rx={3} fill={color} opacity={0.25} />
                  {/* progress fill */}
                  <rect x={barX} y={y + 8} width={barW * prog / 100} height={ROW_H - 16}
                    rx={3} fill={color} opacity={0.9} />
                  {/* bar label */}
                  {barW > 40 && (
                    <text x={barX + 6} y={y + ROW_H / 2 + 4}
                      fill="#fff" fontSize={10} style={{ pointerEvents: 'none' }}>
                      {prog}%
                    </text>
                  )}
                </g>
              )}
            </g>
          )
        })}

        {/* today line */}
        {todayX > LABEL_W && todayX < totalW && (
          <g>
            <line x1={todayX} y1={0} x2={todayX} y2={totalH}
              stroke="#7c4dff" strokeWidth={2} strokeDasharray="4 3" opacity={0.8} />
            <text x={todayX + 3} y={12} fill="#7c4dff" fontSize={10} fontWeight={700}>Today</text>
          </g>
        )}

        {/* label column divider */}
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={totalH}
          stroke="#2a2a3e" strokeWidth={1} />
        <rect x={0} y={0} width={LABEL_W} height={HEADER_H} fill="#1e1e2e" />
        <text x={8} y={HEADER_H / 2 + 5} fill="#666" fontSize={11} fontWeight={600}>Task</text>
      </svg>

      {/* tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10,
          background: '#1e1e2e', border: '1px solid #444',
          borderRadius: 8, padding: '8px 12px', pointerEvents: 'none',
          color: '#fff', fontSize: 12, zIndex: 9999, maxWidth: 220,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{tooltip.task.task_name}</div>
          <div style={{ color: '#aaa' }}>{tooltip.task.start_date} → {tooltip.task.end_date}</div>
          <div style={{ color: STATUS_COLOR[tooltip.task.status], marginTop: 2 }}>
            {tooltip.task.status} · {tooltip.task.progress}%
          </div>
          {tooltip.task.assignee && <div style={{ color: '#666', marginTop: 2 }}>{tooltip.task.assignee}</div>}
        </div>
      )}
    </div>
  )
}
