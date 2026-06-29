/** Мои задачи: список GET /agent/tasks + детали/события + отмена. */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Drawer, Space, Table, Tag, Typography } from 'antd';
import { tasksApi, type TaskCard, type TaskEvent, type TaskSummary } from '../../api/tasks';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function statusColor(status: string): string {
  if (status === 'succeeded') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'cancelled') return 'default';
  return 'blue';
}

export function TasksPage(): JSX.Element {
  const [items, setItems] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TaskCard | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tasksApi.list({ limit: 50 });
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

  const openDetails = useCallback(async (id: string) => {
    setDrawerLoading(true);
    try {
      const [card, ev] = await Promise.all([tasksApi.get(id), tasksApi.events(id)]);
      setSelected(card);
      setEvents(ev.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!selected) return;
    try {
      const updated = await tasksApi.cancel(selected.id);
      setSelected(updated);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selected, load]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => void load()}>Обновить</Button>
      </Space>
      {error && (
        <Alert type="error" closable style={{ marginBottom: 8 }} message={error} onClose={() => setError(null)} />
      )}
      <Table<TaskSummary>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        onRow={(row) => ({ onClick: () => void openDetails(row.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Заголовок', dataIndex: 'title', render: (t: string | null) => t ?? '—' },
          { title: 'Тип', dataIndex: 'taskType', render: (t: string | null) => t ?? '—' },
          {
            title: 'Статус',
            dataIndex: 'status',
            render: (s: string) => <Tag color={statusColor(s)}>{s}</Tag>,
          },
          { title: 'Создана', dataIndex: 'createdAt', render: (d: string) => new Date(d).toLocaleString() },
        ]}
      />

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        width={520}
        title={selected?.title ?? 'Задача'}
        loading={drawerLoading}
        extra={
          selected && !TERMINAL.has(selected.status) ? (
            <Button danger onClick={() => void cancel()}>
              Отменить
            </Button>
          ) : null
        }
      >
        {selected && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>
              Статус: <Tag color={statusColor(selected.status)}>{selected.status}</Tag>
            </Typography.Text>
            <Typography.Text type="secondary">ID: {selected.id}</Typography.Text>
            {selected.errorCode && <Alert type="error" message={`Ошибка: ${selected.errorCode}`} />}
            <Typography.Title level={5}>События</Typography.Title>
            <Table<TaskEvent>
              rowKey="id"
              size="small"
              dataSource={events}
              pagination={false}
              columns={[
                { title: 'Событие', dataIndex: 'eventType' },
                { title: 'Статус', dataIndex: 'status', render: (s: string | null) => s ?? '—' },
                { title: 'Время', dataIndex: 'createdAt', render: (d: string) => new Date(d).toLocaleTimeString() },
              ]}
            />
          </Space>
        )}
      </Drawer>
    </div>
  );
}
