/** Обёртка React Flow: регистрирует единый узел `block`, прокидывает обработчики. */
import { ReactFlow, Background, Controls, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BlockNode } from './nodes/BlockNode';
import type { WorkflowEditorApi } from '../useWorkflowEditor';

const nodeTypes = { block: BlockNode };

export function WorkflowCanvas({ editor }: { editor: WorkflowEditorApi }): JSX.Element {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={editor.nodes}
          edges={editor.edges}
          nodeTypes={nodeTypes}
          onNodesChange={editor.onNodesChange}
          onEdgesChange={editor.onEdgesChange}
          onConnect={editor.onConnect}
          onNodeClick={(_, node) => editor.setSelectedId(node.id)}
          onPaneClick={() => editor.setSelectedId(null)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
