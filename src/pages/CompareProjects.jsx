import { useMemo, useState } from 'react'
import ReactFlow, { Background, Controls, MiniMap, ReactFlowProvider } from 'reactflow'
import 'reactflow/dist/style.css'

import { useStore } from '../store/useStore'
import { getProjects, rowsToEdges, rowsToNodes, STATUS_COLOR } from '../utils/projectUtils'
import { nodeTypes } from '../components/FlowNodes'

export default function CompareProjects({ onBack }) {
  const rows = useStore(state => state.getRows())
  const projects = getProjects(rows)
  const [projectA, setProjectA] = useState(projects[0]?.id ?? '')
  const [projectB, setProjectB] = useState(projects[1]?.id ?? projects[0]?.id ?? '')
  const projectMap = new Map(projects.map(project => [project.id, project]))

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f0f17', color: '#fff' }}>
      <header style={{
        minHeight: 54, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: '#16161f', borderBottom: '1px solid #2a2a3e',
      }}>
        <button onClick={onBack} style={buttonStyle('#333')}>← Back</button>
        <strong style={{ fontSize: 15 }}>Compare Projects</strong>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>Stacked timeline canvases · read only</span>
      </header>

      {projects.length < 2 ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#aaa', textAlign: 'center', padding: 24 }}>
          <div>
            <div style={{ fontSize: 32, marginBottom: 10 }}>▤</div>
            <div style={{ color: '#fff', fontWeight: 700, marginBottom: 6 }}>Add another project to compare</div>
            <div>Project comparison needs at least two projects on the board.</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CompareCanvas
            label="Project A"
            projects={projects}
            selectedProject={projectA}
            onSelect={setProjectA}
            project={projectMap.get(projectA)}
          />
          <div style={{ height: 1, flex: '0 0 1px', background: '#7c4dff' }} />
          <CompareCanvas
            label="Project B"
            projects={projects}
            selectedProject={projectB}
            onSelect={setProjectB}
            project={projectMap.get(projectB)}
          />
        </div>
      )}
    </div>
  )
}

function CompareCanvas({ label, projects, selectedProject, onSelect, project }) {
  const nodes = useMemo(() => rowsToNodes(project?.tasks ?? []), [project])
  const edges = useMemo(() => rowsToEdges(project?.tasks ?? []), [project])

  return (
    <section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{
        flex: '0 0 40px', display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px', background: '#14141d', borderBottom: '1px solid #2a2a3e', zIndex: 2,
      }}>
        <span style={{ color: '#aaa', width: 72, fontSize: 12, fontWeight: 700 }}>{label}</span>
        <select
          value={selectedProject}
          onChange={event => onSelect(event.target.value)}
          aria-label={`Choose ${label}`}
          style={{ background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '5px 9px', maxWidth: 320 }}
        >
          {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <span style={{ color: '#777', fontSize: 12 }}>{project?.tasks.length ?? 0} tasks and events</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
          >
            <Background color="#2a2a3e" gap={20} />
            <Controls style={{ background: '#16161f', border: '1px solid #333' }} />
            <MiniMap
              nodeColor={node => STATUS_COLOR[node.data?.status] ?? '#9E9E9E'}
              style={{ background: '#16161f', border: '1px solid #333' }}
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </section>
  )
}

const buttonStyle = bg => ({
  background: bg, border: 'none', borderRadius: 6, color: '#fff',
  padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
})
