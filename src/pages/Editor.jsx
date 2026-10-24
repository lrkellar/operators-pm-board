import { useCallback, useState } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useStore } from '../store/useStore'
import { rowsToNodes, rowsToEdges, STATUS_COLOR } from '../utils/projectUtils'
import { nodeTypes } from '../components/FlowNodes'
import TaskPanel from '../components/TaskPanel'

export default function Editor({ projectId, onBack }) {
  const { getRows, setRows } = useStore()
  const allRows  = getRows()
  const projRows = allRows.filter(r => r.project_id === projectId)
  const projName = projRows[0]?.project_name ?? projectId

  const [nodes, setNodes, onNodesChange] = useNodesState(rowsToNodes(projRows))
  const [edges, setEdges, onEdgesChange] = useEdgesState(rowsToEdges(projRows))
  const [selectedTask, setSelectedTask]  = useState(null)
  const [saved, setSaved]                = useState(false)

  // When an edge is drawn between two nodes, update dependency
  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params,
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#aaa' },
    }, eds))
    // update dep in node data
    setNodes(nds => nds.map(n =>
      n.id === params.target ? { ...n, data: { ...n.data, dependencies: params.source } } : n
    ))
  }, [setEdges, setNodes])

  const onNodeClick = useCallback((_, node) => {
    setSelectedTask(node.data)
  }, [])

  const onPaneClick = useCallback(() => setSelectedTask(null), [])

  // Live-sync edges when deps change in the panel
  const handleDepsChange = useCallback((taskId, depIds) => {
    setEdges(eds => {
      // remove all edges pointing to this task
      const filtered = eds.filter(e => e.target !== taskId)
      // add one edge per dep
      const newEdges = depIds.map(srcId => ({
        id: `e-${srcId}-${taskId}`,
        source: srcId,
        target: taskId,
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#7c4dff' },
      }))
      return [...filtered, ...newEdges]
    })
    // keep node data in sync too
    setNodes(nds => nds.map(n =>
      n.id === taskId ? { ...n, data: { ...n.data, dependencies: depIds.join(',') } } : n
    ))
  }, [setEdges, setNodes])

  // Save node positions + data back to rows
  const handleSaveTask = (formData) => {
    setNodes(nds => nds.map(n =>
      n.id === formData.task_id
        ? { ...n, type: formData.type === 'milestone' ? 'milestone' : 'taskNode', data: { ...formData } }
        : n
    ))
    setSelectedTask(null)
  }

  const handleDeleteTask = (taskId) => {
    setNodes(nds => nds.filter(n => n.id !== taskId))
    setEdges(eds => eds.filter(e => e.source !== taskId && e.target !== taskId))
    setSelectedTask(null)
  }

  const addTask = () => {
    const id = `${projectId}_${Date.now()}`
    const newNode = {
      id,
      type: 'taskNode',
      position: { x: 200, y: 200 },
      data: {
        task_id: id, project_id: projectId, project_name: projName,
        task_name: 'New Task', status: 'not_started', type: 'task',
        assignee: '', start_date: '', end_date: '', progress: 0,
        dependencies: '', file_link: '', notes: '',
      },
    }
    setNodes(nds => [...nds, newNode])
    setSelectedTask(newNode.data)
  }

  const addMilestone = () => {
    const id = `${projectId}_ms_${Date.now()}`
    const newNode = {
      id,
      type: 'milestone',
      position: { x: 400, y: 200 },
      data: {
        task_id: id, project_id: projectId, project_name: projName,
        task_name: 'Milestone', status: 'not_started', type: 'milestone',
        assignee: '', start_date: '', end_date: '', progress: 0,
        dependencies: '', file_link: '', notes: '',
      },
    }
    setNodes(nds => [...nds, newNode])
    setSelectedTask(newNode.data)
  }

  const saveToStore = () => {
    // Build a map of target -> [sources] to support multiple deps
    const edgeDepMap = {}
    edges.forEach(e => {
      if (!edgeDepMap[e.target]) edgeDepMap[e.target] = []
      edgeDepMap[e.target].push(e.source)
    })

    const updatedProjRows = nodes.map(n => ({
      ...n.data,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      dependencies: edgeDepMap[n.id]?.join(',') ?? n.data.dependencies ?? '',
    }))

    const otherRows = allRows.filter(r => r.project_id !== projectId)
    setRows([...otherRows, ...updatedProjRows])
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const allProjTasks = nodes.map(n => n.data)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f0f17' }}>
      {/* toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        background: '#16161f', borderBottom: '1px solid #2a2a3e',
      }}>
        <button onClick={onBack} style={btnStyle('#333')}>← Back</button>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, flex: 1 }}>{projName}</span>
        <button onClick={addTask}      style={btnStyle('#2196F3')}>+ Task</button>
        <button onClick={addMilestone} style={btnStyle('#FF9800')}>◆ Milestone</button>
        <button onClick={saveToStore}  style={btnStyle(saved ? '#4CAF50' : '#7c4dff')}>
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {/* canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode="Delete"
        >
          <Background color="#2a2a3e" gap={20} />
          <Controls style={{ background: '#16161f', border: '1px solid #333' }} />
          <MiniMap
            nodeColor={n => STATUS_COLOR[n.data?.status] ?? '#9E9E9E'}
            style={{ background: '#16161f', border: '1px solid #333' }}
          />
        </ReactFlow>

        <TaskPanel
          task={selectedTask}
          allTasks={allProjTasks}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onClose={() => setSelectedTask(null)}
          onDepsChange={handleDepsChange}
        />
      </div>
    </div>
  )
}

const btnStyle = (bg) => ({
  background: bg, border: 'none', borderRadius: 6, color: '#fff',
  fontWeight: 600, padding: '6px 14px', cursor: 'pointer', fontSize: 13,
})
