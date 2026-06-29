/**
 * Оболочка редактора: тулбар (Назад / имя / Сохранить / Опубликовать / Тест-запуск /
 * индикатор валидации) + 3 панели (палитра / канвас / конфиг). Каталог = 12 базовых
 * блоков, аугментированных живыми GET /tools. Публикация/тест-запуск блокируются при
 * ошибках графа. Сам workflow НЕ исполняется во фронтенде.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, Input, Row, Space, Tag, Typography } from 'antd';
import { api } from '../../api/client';
import { BASE_BLOCKS, mergeLiveTools } from './catalog';
import { useWorkflowEditor } from './useWorkflowEditor';
import { WorkflowCanvas } from './canvas/WorkflowCanvas';
import { BlockPalette } from './canvas/BlockPalette';
import { NodeConfigPanel } from './canvas/NodeConfigPanel';
import { TestRunDrawer } from './TestRunDrawer';
import type { ToolMetadata } from './types';

export function WorkflowEditor({
  templateId,
  onBack,
  onSaved,
}: {
  templateId: string | null;
  onBack: () => void;
  onSaved?: (id: string) => void;
}): JSX.Element {
  const editor = useWorkflowEditor(templateId, onSaved);
  const [tools, setTools] = useState<ToolMetadata[]>([]);
  const [runTaskId, setRunTaskId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    api
      .get<{ tools: ToolMetadata[] }>('/tools')
      .then((r) => setTools(r.tools))
      .catch(() => setTools([]));
  }, []);

  const { catalog } = useMemo(() => mergeLiveTools(BASE_BLOCKS, tools), [tools]);
  const errorIssues = editor.graphIssues.filter((i) => i.severity === 'error');
  const warnIssues = editor.graphIssues.filter((i) => i.severity === 'warning');
  const blocked = errorIssues.length > 0;

  const handleTestRun = async (): Promise<void> => {
    const id = await editor.testRun();
    if (id) {
      setRunTaskId(id);
      setDrawerOpen(true);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button onClick={onBack}>← Назад</Button>
          <Input
            value={editor.name}
            onChange={(e) => editor.setName(e.target.value)}
            style={{ width: 280 }}
            placeholder="Название шаблона"
          />
          <Tag color={editor.status === 'published' ? 'green' : 'default'}>
            {editor.status} · v{editor.version}
          </Tag>
        </Space>
        <Space>
          {blocked ? (
            <Tag color="red">{errorIssues.length} ошибок</Tag>
          ) : (
            <Tag color="green">граф валиден</Tag>
          )}
          <Button loading={editor.busy} onClick={() => void editor.saveDraft()}>
            Сохранить черновик
          </Button>
          <Button loading={editor.busy} disabled={blocked} onClick={() => void editor.publish()}>
            Опубликовать
          </Button>
          <Button
            type="primary"
            loading={editor.busy}
            disabled={blocked}
            onClick={() => void handleTestRun()}
          >
            Тест-запуск
          </Button>
        </Space>
      </Space>

      {editor.error && (
        <Alert
          type="error"
          closable
          style={{ marginBottom: 8 }}
          message={editor.error}
          onClose={() => editor.setError(null)}
        />
      )}
      {!editor.error && blocked && (
        <Alert
          type="warning"
          style={{ marginBottom: 8 }}
          message="Проблемы графа"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errorIssues.map((i, idx) => (
                <li key={idx}>{i.message}</li>
              ))}
              {warnIssues.map((i, idx) => (
                <li key={`w${idx}`}>
                  <Typography.Text type="warning">{i.message}</Typography.Text>
                </li>
              ))}
            </ul>
          }
        />
      )}

      <Row gutter={8}>
        <Col span={5} style={{ maxHeight: '72vh', overflow: 'auto' }}>
          <BlockPalette catalog={catalog} onAdd={(b) => editor.addNode(b)} />
        </Col>
        <Col span={14}>
          <div style={{ height: '72vh', border: '1px solid #f0f0f0', borderRadius: 8 }}>
            <WorkflowCanvas editor={editor} />
          </div>
        </Col>
        <Col span={5} style={{ maxHeight: '72vh', overflow: 'auto' }}>
          <NodeConfigPanel editor={editor} catalog={catalog} />
        </Col>
      </Row>

      <TestRunDrawer taskId={runTaskId} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
