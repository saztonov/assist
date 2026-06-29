/** Approvals: список pending + approve/reject (с optional reason). */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Space, Table, Tag, message } from 'antd';
import { approvalsApi, type ApprovalCard } from '../../api/approvals';

export function ApprovalsPage(): JSX.Element {
  const [items, setItems] = useState<ApprovalCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await approvalsApi.list('pending');
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

  const decide = useCallback(
    async (id: string, decision: 'approve' | 'reject') => {
      try {
        if (decision === 'approve') await approvalsApi.approve(id, reason || undefined);
        else await approvalsApi.reject(id, reason || undefined);
        message.success(decision === 'approve' ? 'Подтверждено' : 'Отклонено');
        setReason('');
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reason, load],
  );

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => void load()}>Обновить</Button>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина (необязательно)"
          style={{ width: 280 }}
        />
      </Space>
      {error && (
        <Alert type="error" closable style={{ marginBottom: 8 }} message={error} onClose={() => setError(null)} />
      )}
      <Table<ApprovalCard>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: 'Нет ожидающих подтверждений' }}
        columns={[
          { title: 'Действие', dataIndex: 'action' },
          { title: 'Ресурс', dataIndex: 'resource', render: (r: string | null) => r ?? '—' },
          {
            title: 'Риск',
            dataIndex: 'riskLevel',
            render: (r: string) => <Tag color={r === 'high' ? 'red' : 'orange'}>{r}</Tag>,
          },
          { title: 'Создано', dataIndex: 'createdAt', render: (d: string) => new Date(d).toLocaleString() },
          {
            title: '',
            key: 'actions',
            render: (_, row) => (
              <Space>
                <Popconfirm title="Подтвердить?" onConfirm={() => void decide(row.id, 'approve')}>
                  <Button type="primary" size="small">
                    Approve
                  </Button>
                </Popconfirm>
                <Popconfirm title="Отклонить?" onConfirm={() => void decide(row.id, 'reject')}>
                  <Button danger size="small">
                    Reject
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
