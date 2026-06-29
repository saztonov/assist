/** Drawer тест-прогона: живой статус задачи + лента событий. Фронт workflow НЕ исполняет. */
import { Drawer, Empty, Spin, Tag, Timeline, Typography } from 'antd';
import { useTestRunPoller } from './useTestRunPoller';
import type { TaskStatus } from './types';

const STATUS_COLOR: Record<TaskStatus, string> = {
  created: 'default',
  queued: 'blue',
  running: 'processing',
  waiting_for_approval: 'gold',
  completed: 'green',
  failed: 'red',
  cancelled: 'default',
};

export function TestRunDrawer({
  taskId,
  open,
  onClose,
}: {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { task, events, polling } = useTestRunPoller(open ? taskId : null);

  return (
    <Drawer title="Тест-запуск" width={440} open={open} onClose={onClose}>
      {!task && <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {task && (
        <>
          <Typography.Paragraph>
            <Tag color={STATUS_COLOR[task.status]}>{task.status}</Tag>
            {polling && <Spin size="small" style={{ marginLeft: 8 }} />}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            task: {task.id}
            {task.workflowId ? ` · workflow: ${task.workflowId}` : ''}
            {task.errorCode ? ` · ошибка: ${task.errorCode}` : ''}
          </Typography.Paragraph>
          <Timeline
            items={events.map((e) => ({
              children: (
                <span>
                  <Typography.Text strong>{e.eventType}</Typography.Text>
                  {e.status ? ` · ${e.status}` : ''}
                  {e.message ? ` — ${e.message}` : ''}
                </span>
              ),
            }))}
          />
        </>
      )}
    </Drawer>
  );
}
