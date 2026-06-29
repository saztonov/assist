/**
 * Документы: загрузка файла через upload-session → presigned PUT в S3 → confirm.
 * Presigned PUT идёт напрямую в хранилище (by design); URL не логируется.
 * Если backend документов выключен (501/404) — показываем дружелюбное состояние.
 */
import { useCallback, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Table, Tag, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { isNotImplemented } from '../../api/client';
import { documentsApi, putToPresignedUrl, type DocumentCard } from '../../api/documents';

type SecurityLevel = 'public' | 'internal' | 'confidential' | 'secret';

export function DocumentsPage(): JSX.Element {
  const [uploaded, setUploaded] = useState<DocumentCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [title, setTitle] = useState('');
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>('internal');
  const [busy, setBusy] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        // 1) upload-session → presigned URL
        const session = await documentsApi.createUploadSession({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          title: title || undefined,
          securityLevel,
        });
        // 2) presigned PUT напрямую в S3 (Content-Type обязан совпадать)
        await putToPresignedUrl(session.uploadUrl, file, file.type || 'application/octet-stream');
        // 3) confirm + получить карточку
        await documentsApi.confirm(session.documentId);
        const card = await documentsApi.get(session.documentId);
        setUploaded((prev) => [card, ...prev]);
        message.success(`Загружено: ${file.name}`);
        setError(null);
      } catch (e) {
        if (isNotImplemented(e)) {
          setDisabled(true);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setBusy(false);
      }
    },
    [title, securityLevel],
  );

  const uploadProps: UploadProps = {
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      void upload(file as File);
      return false; // не даём AntD грузить самому — управляем потоком вручную
    },
  };

  if (disabled) {
    return (
      <Alert
        type="info"
        showIcon
        message="Хранилище документов отключено"
        description="Backend документов недоступен (DOCUMENTS_ENABLED=false или S3 не настроен)."
      />
    );
  }

  return (
    <div>
      {error && (
        <Alert type="error" closable style={{ marginBottom: 8 }} message={error} onClose={() => setError(null)} />
      )}
      <Space style={{ marginBottom: 12 }} wrap>
        <Form layout="inline">
          <Form.Item label="Заголовок">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="необязательно" />
          </Form.Item>
          <Form.Item label="Уровень">
            <Select<SecurityLevel>
              value={securityLevel}
              style={{ width: 160 }}
              onChange={setSecurityLevel}
              options={[
                { value: 'public', label: 'public' },
                { value: 'internal', label: 'internal' },
                { value: 'confidential', label: 'confidential' },
                { value: 'secret', label: 'secret' },
              ]}
            />
          </Form.Item>
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />} type="primary" loading={busy}>
              Загрузить файл
            </Button>
          </Upload>
        </Form>
      </Space>

      <Table<DocumentCard>
        rowKey="id"
        dataSource={uploaded}
        pagination={false}
        locale={{ emptyText: 'Пока ничего не загружено' }}
        columns={[
          { title: 'Заголовок', dataIndex: 'title', render: (t: string | null) => t ?? '—' },
          { title: 'Тип', dataIndex: 'documentType', render: (t: string | null) => t ?? '—' },
          { title: 'Уровень', dataIndex: 'securityLevel', render: (s: string) => <Tag>{s}</Tag> },
          { title: 'Статус', dataIndex: 'status', render: (s: string) => <Tag color="blue">{s}</Tag> },
        ]}
      />
    </div>
  );
}
