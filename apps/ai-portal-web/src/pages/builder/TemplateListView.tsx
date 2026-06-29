/** Список шаблонов: GET /workflow-templates. Открытие → редактор; «Новый шаблон». */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Space, Table, Tag, Typography } from 'antd';
import { api } from '../../api/client';
import type { WorkflowTemplateListItem } from './types';

export function TemplateListView({
  onOpen,
}: {
  onOpen: (templateId: string | null) => void;
}): JSX.Element {
  const [items, setItems] = useState<WorkflowTemplateListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: WorkflowTemplateListItem[] }>('/workflow-templates');
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => onOpen(null)}>
          Новый шаблон
        </Button>
        <Button onClick={() => void load()}>Обновить</Button>
      </Space>
      {error && (
        <Alert type="error" closable style={{ marginBottom: 8 }} message={error} onClose={() => setError(null)} />
      )}
      <Table<WorkflowTemplateListItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          {
            title: 'Название',
            dataIndex: 'name',
            render: (name: string, row) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => onOpen(row.id)}>
                {name}
              </Button>
            ),
          },
          { title: 'Ключ', dataIndex: 'key', render: (k: string) => <Typography.Text code>{k}</Typography.Text> },
          {
            title: 'Статус',
            dataIndex: 'status',
            render: (s: string) => <Tag color={s === 'published' ? 'green' : 'default'}>{s}</Tag>,
          },
          {
            title: 'Обновлён',
            dataIndex: 'updatedAt',
            render: (d: string) => new Date(d).toLocaleString(),
          },
          {
            title: '',
            key: 'actions',
            render: (_, row) => (
              <Button size="small" onClick={() => onOpen(row.id)}>
                Открыть
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
