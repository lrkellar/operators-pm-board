import { Handle, Position } from 'reactflow'
import { STATUS_COLOR, STATUS_LABEL } from '../utils/projectUtils'

// ── Task node (rectangle) ─────────────────────────────────────────────────────
export function TaskNode({ data, selected }) {
  const color = STATUS_COLOR[data.status] ?? '#9E9E9E'
  return (
    <div style={{
      background: '#1e1e2e',
      border: `2px solid ${selected ? '#fff' : color}`,
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 180,
      maxWidth: 220,
      boxShadow: selected ? `0 0 0 2px ${color}` : 'none',
      cursor: 'grab',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <div style={{ fontSize: 11, color, marginBottom: 2 }}>{STATUS_LABEL[data.status]}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
        {data.task_name}
      </div>
      <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
        {data.assignee} · {data.end_date}
      </div>
      <div style={{ marginTop: 6, background: '#333', borderRadius: 4, height: 4 }}>
        <div style={{
          width: `${data.progress ?? 0}%`,
          background: color,
          height: '100%',
          borderRadius: 4,
          transition: 'width 0.3s',
        }} />
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  )
}

// ── Milestone node (diamond) ──────────────────────────────────────────────────
export function MilestoneNode({ data, selected }) {
  const color = STATUS_COLOR[data.status] ?? '#9E9E9E'
  const size = 90
  return (
    <div style={{ position: 'relative', width: size, height: size, cursor: 'grab' }}>
      <Handle type="target" position={Position.Left}
        style={{ background: color, top: '50%', left: -6 }} />
      <div style={{
        width: size,
        height: size,
        transform: 'rotate(45deg)',
        background: '#1e1e2e',
        border: `2px solid ${selected ? '#fff' : color}`,
        boxShadow: selected ? `0 0 0 2px ${color}` : 'none',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 4,
        pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 10, color, fontWeight: 700 }}>◆ MILESTONE</div>
        <div style={{ fontSize: 11, color: '#fff', fontWeight: 600, lineHeight: 1.2, marginTop: 2 }}>
          {data.task_name}
        </div>
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{data.end_date}</div>
      </div>
      <Handle type="source" position={Position.Right}
        style={{ background: color, top: '50%', right: -6 }} />
    </div>
  )
}

export const nodeTypes = {
  taskNode:  TaskNode,
  milestone: MilestoneNode,
}
