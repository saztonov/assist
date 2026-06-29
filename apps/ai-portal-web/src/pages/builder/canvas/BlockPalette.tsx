/** Левая палитра блоков (click-to-add). Недоступные инструменты помечаются. */
import { Button, Collapse, Space, Tag, Tooltip, Typography } from 'antd';
import type { BlockDef, BlockGroup } from '../catalog';

const RISK_COLOR: Record<string, string> = { low: 'green', medium: 'gold', high: 'red' };

export function BlockPalette({
  catalog,
  onAdd,
}: {
  catalog: BlockDef[];
  onAdd: (block: BlockDef) => void;
}): JSX.Element {
  const groups: BlockGroup[] = [];
  for (const b of catalog) if (!groups.includes(b.group)) groups.push(b.group);

  return (
    <Collapse
      defaultActiveKey={groups}
      size="small"
      items={groups.map((group) => ({
        key: group,
        label: group,
        children: (
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            {catalog
              .filter((b) => b.group === group)
              .map((block) => (
                <Tooltip
                  key={block.key}
                  title={block.available === false ? 'Инструмент не зарегистрирован' : block.description}
                >
                  <Button
                    block
                    size="small"
                    style={{ textAlign: 'left' }}
                    danger={block.available === false}
                    onClick={() => onAdd(block)}
                  >
                    <Space size={4}>
                      <Typography.Text ellipsis>{block.label}</Typography.Text>
                      {block.riskLevel && (
                        <Tag color={RISK_COLOR[block.riskLevel]} style={{ margin: 0 }}>
                          {block.riskLevel}
                        </Tag>
                      )}
                      {block.requiresApproval && (
                        <Tag color="orange" style={{ margin: 0 }}>
                          approval
                        </Tag>
                      )}
                    </Space>
                  </Button>
                </Tooltip>
              ))}
          </Space>
        ),
      }))}
    />
  );
}
