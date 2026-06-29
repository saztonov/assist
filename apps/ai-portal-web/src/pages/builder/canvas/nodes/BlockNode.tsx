/** Единый data-driven узел для всех видов блоков. Триггеры — только source-handle. */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Tag, Typography } from 'antd';
import { isTriggerType } from '@su10/workflow-schema';
import type { BlockNodeType } from '../nodeType';

export function BlockNode({ data, selected }: NodeProps<BlockNodeType>): JSX.Element {
  const isTrigger = isTriggerType(data.nodeType);
  const isApproval = data.nodeType.toLowerCase() === 'approval';
  return (
    <div
      style={{
        minWidth: 160,
        padding: '8px 12px',
        borderRadius: 8,
        border: `1px solid ${selected ? '#1677ff' : '#d9d9d9'}`,
        background: isApproval ? '#fff7e6' : '#ffffff',
        boxShadow: selected ? '0 0 0 2px rgba(22,119,255,0.2)' : 'none',
      }}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <Typography.Text strong style={{ fontSize: 13 }}>
        {data.label ?? data.nodeType}
      </Typography.Text>
      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {data.toolRef && <Tag style={{ margin: 0 }}>{data.toolRef}</Tag>}
        {data.agentName && <Tag color="blue" style={{ margin: 0 }}>{data.agentName}</Tag>}
        {isApproval && <Tag color="orange" style={{ margin: 0 }}>approval</Tag>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
