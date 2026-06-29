/** Подключения: read-only список GET /connectors. Создание/мастер — будущий этап. */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Space, Table, Tag } from 'antd';
import { isNotImplemented } from '../../api/client';
import { connectorsApi, type ConnectionCard } from '../../api/connectors';

export function ConnectorsPage(): JSX.Element {
  const [items, setItems] = useState<ConnectionCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await connectorsApi.list();
      setItems(res.connections);
      setError(null);
    } catch (e) {
      if (isNotImplemented(e)) setDisabled(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (disabled) {
    return (
      <Alert
        type="info"
        showIcon
        message="Почтовый коннектор отключён"
        description="MAIL_CONNECTOR_ENABLED=false или коннектор не настроен на backend."
      />
    );
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => void load()}>Обновить</Button>
      </Space>
      {error && (
        <Alert type="error" closable style={{ marginBottom: 8 }} message={error} onClose={() => setError(null)} />
      )}
      <Table<ConnectionCard>
        rowKey="connectorAccountId"
        loading={loading}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: 'Нет подключений' }}
        columns={[
          { title: 'Название', dataIndex: 'displayName', render: (n: string | null) => n ?? '—' },
          { title: 'Тип', dataIndex: 'providerKind', render: (p: string | null) => p ?? '—' },
          { title: 'Ящик', dataIndex: 'mailbox', render: (m: string | null) => m ?? '—' },
          {
            title: 'Статус',
            dataIndex: 'status',
            render: (s: string, row) => (
              <Tag color={row.enabled ? 'green' : 'default'}>{s}</Tag>
            ),
          },
        ]}
      />
    </div>
  );
}
