/**
 * Admin page «Модели» — analyze current models, register new providers/models,
 * manage routing policies, check health and run a sandbox model test. Calls only
 * the backend `/llm/*` admin API (never LM Studio directly).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { api } from '../../api/client';

interface MergedModel {
  modelId: string;
  purpose: string | null;
  contextWindow: number | null;
  maxParallelRequests: number | null;
  registered: boolean;
  available: boolean;
}
interface Provider {
  id: string;
  providerType: string;
  displayName: string;
  enabled: boolean;
  localOnly: boolean;
  cloudAllowed: boolean;
  hasToken: boolean;
}
interface Policy {
  id: string;
  name: string;
  dataClass: string;
  decision: string;
  enabled: boolean;
  priority: number;
}

function useAsyncError(): [string | null, (e: unknown) => void, () => void] {
  const [error, setError] = useState<string | null>(null);
  return [error, (e) => setError(e instanceof Error ? e.message : String(e)), () => setError(null)];
}

export function ModelsPage(): JSX.Element {
  const [error, onError, clearError] = useAsyncError();

  const [models, setModels] = useState<MergedModel[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [health, setHealth] = useState<string>('');

  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [modelModalProvider, setModelModalProvider] = useState<Provider | null>(null);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);

  const loadModels = useCallback(async () => {
    try {
      setModels((await api.get<{ models: MergedModel[] }>('/llm/models')).models);
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  const loadProviders = useCallback(async () => {
    try {
      setProviders((await api.get<{ providers: Provider[] }>('/llm/providers')).providers);
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  const loadPolicies = useCallback(async () => {
    try {
      setPolicies((await api.get<{ policies: Policy[] }>('/llm/policies')).policies);
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  useEffect(() => {
    void loadModels();
    void loadProviders();
    void loadPolicies();
  }, [loadModels, loadProviders, loadPolicies]);

  const testModel = async (modelId: string): Promise<void> => {
    try {
      const res = await api.post<{ ok: boolean; model?: string; errorCode?: string }>(
        `/llm/models/${encodeURIComponent(modelId)}/test`,
      );
      if (res.ok) message.success(`Модель ${res.model ?? modelId} ответила`);
      else message.error(`Тест не пройден: ${res.errorCode ?? 'ошибка'}`);
    } catch (e) {
      onError(e);
    }
  };

  const checkHealth = async (): Promise<void> => {
    try {
      const res = await api.get<{ status: string; models: string[] }>('/llm/health');
      setHealth(`${res.status} (${res.models.length} моделей)`);
    } catch (e) {
      onError(e);
    }
  };

  const modelsTab = (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => void loadModels()}>Обновить</Button>
        <Button onClick={() => void checkHealth()}>Проверить health</Button>
        {health && <Tag color="blue">health: {health}</Tag>}
      </Space>
      <Table<MergedModel>
        rowKey="modelId"
        dataSource={models}
        pagination={false}
        columns={[
          { title: 'Модель', dataIndex: 'modelId' },
          { title: 'Назначение', dataIndex: 'purpose', render: (v) => v ?? '—' },
          { title: 'Контекст', dataIndex: 'contextWindow', render: (v) => v ?? '—' },
          { title: 'Параллелизм', dataIndex: 'maxParallelRequests', render: (v) => v ?? '—' },
          {
            title: 'Статус',
            render: (_, r) => (
              <Space>
                <Tag color={r.registered ? 'green' : 'default'}>
                  {r.registered ? 'в реестре' : 'не в реестре'}
                </Tag>
                <Tag color={r.available ? 'green' : 'red'}>
                  {r.available ? 'доступна' : 'недоступна'}
                </Tag>
              </Space>
            ),
          },
          {
            title: 'Действия',
            render: (_, r) => (
              <Button size="small" onClick={() => void testModel(r.modelId)}>
                Тест
              </Button>
            ),
          },
        ]}
      />
    </>
  );

  const providersTab = (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => setProviderModalOpen(true)}>
          Добавить провайдера
        </Button>
        <Button onClick={() => void loadProviders()}>Обновить</Button>
      </Space>
      <Table<Provider>
        rowKey="id"
        dataSource={providers}
        pagination={false}
        columns={[
          { title: 'Название', dataIndex: 'displayName' },
          { title: 'Тип', dataIndex: 'providerType' },
          { title: 'Включён', dataIndex: 'enabled', render: (v) => (v ? 'да' : 'нет') },
          { title: 'Local-only', dataIndex: 'localOnly', render: (v) => (v ? 'да' : 'нет') },
          { title: 'Токен', dataIndex: 'hasToken', render: (v) => (v ? 'задан' : '—') },
          {
            title: 'Действия',
            render: (_, r) => (
              <Button size="small" onClick={() => setModelModalProvider(r)}>
                Добавить модель
              </Button>
            ),
          },
        ]}
      />
    </>
  );

  const policiesTab = (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => setPolicyModalOpen(true)}>
          Добавить политику
        </Button>
        <Button onClick={() => void loadPolicies()}>Обновить</Button>
      </Space>
      <Table<Policy>
        rowKey="id"
        dataSource={policies}
        pagination={false}
        columns={[
          { title: 'Имя', dataIndex: 'name' },
          { title: 'Класс данных', dataIndex: 'dataClass' },
          { title: 'Решение', dataIndex: 'decision' },
          { title: 'Приоритет', dataIndex: 'priority' },
          { title: 'Включена', dataIndex: 'enabled', render: (v) => (v ? 'да' : 'нет') },
        ]}
      />
    </>
  );

  return (
    <div>
      <Typography.Title level={4}>Модели LLM</Typography.Title>
      {error && (
        <Alert
          type="error"
          closable
          onClose={clearError}
          message={error}
          style={{ marginBottom: 12 }}
        />
      )}
      <Tabs
        items={[
          { key: 'models', label: 'Модели', children: modelsTab },
          { key: 'providers', label: 'Провайдеры', children: providersTab },
          { key: 'policies', label: 'Политики', children: policiesTab },
        ]}
      />

      <ProviderModal
        open={providerModalOpen}
        onClose={() => setProviderModalOpen(false)}
        onCreated={() => {
          setProviderModalOpen(false);
          void loadProviders();
        }}
        onError={onError}
      />
      <ModelModal
        provider={modelModalProvider}
        onClose={() => setModelModalProvider(null)}
        onCreated={() => {
          setModelModalProvider(null);
          void loadModels();
        }}
        onError={onError}
      />
      <PolicyModal
        open={policyModalOpen}
        onClose={() => setPolicyModalOpen(false)}
        onCreated={() => {
          setPolicyModalOpen(false);
          void loadPolicies();
        }}
        onError={onError}
      />
    </div>
  );
}

function ProviderModal(props: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [form] = Form.useForm();
  return (
    <Modal
      title="Новый провайдер"
      open={props.open}
      onCancel={props.onClose}
      onOk={() => {
        form
          .validateFields()
          .then((values) => api.post('/llm/providers', values))
          .then(props.onCreated)
          .catch(props.onError);
      }}
    >
      <Form form={form} layout="vertical" initialValues={{ providerType: 'lmstudio', localOnly: true }}>
        <Form.Item name="providerType" label="Тип" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'lmstudio', label: 'LM Studio' },
              { value: 'openai_compatible_saas', label: 'OpenAI-compatible SaaS' },
              { value: 'embedding_provider', label: 'Embedding provider' },
              { value: 'rerank_provider', label: 'Rerank provider' },
            ]}
          />
        </Form.Item>
        <Form.Item name="displayName" label="Название" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="apiTokenSecretRef" label="Ссылка на секрет токена (env:NAME)">
          <Input placeholder="env:LLM_STUDIO_API_TOKEN" />
        </Form.Item>
        <Form.Item name="localOnly" label="Только локально" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ModelModal(props: {
  provider: Provider | null;
  onClose: () => void;
  onCreated: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [form] = Form.useForm();
  return (
    <Modal
      title={`Модель для «${props.provider?.displayName ?? ''}»`}
      open={props.provider !== null}
      onCancel={props.onClose}
      onOk={() => {
        const id = props.provider?.id;
        if (!id) return;
        form
          .validateFields()
          .then((values) => api.post(`/llm/providers/${id}/models`, values))
          .then(props.onCreated)
          .catch(props.onError);
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="modelId" label="ID модели" rules={[{ required: true }]}>
          <Input placeholder="qwen36-27b-mtp" />
        </Form.Item>
        <Form.Item name="purpose" label="Назначение">
          <Select
            allowClear
            options={[
              { value: 'chat', label: 'chat' },
              { value: 'ocr', label: 'ocr' },
              { value: 'extraction', label: 'extraction' },
              { value: 'analysis', label: 'analysis' },
              { value: 'embedding', label: 'embedding' },
            ]}
          />
        </Form.Item>
        <Form.Item name="contextWindow" label="Окно контекста">
          <InputNumber style={{ width: '100%' }} min={1} />
        </Form.Item>
        <Form.Item name="maxParallelRequests" label="Макс. параллелизм">
          <InputNumber style={{ width: '100%' }} min={1} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function PolicyModal(props: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [form] = Form.useForm();
  return (
    <Modal
      title="Новая политика"
      open={props.open}
      onCancel={props.onClose}
      onOk={() => {
        form
          .validateFields()
          .then((values) => api.post('/llm/policies', values))
          .then(props.onCreated)
          .catch(props.onError);
      }}
    >
      <Form form={form} layout="vertical" initialValues={{ decision: 'deny' }}>
        <Form.Item name="name" label="Имя" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="dataClass" label="Класс данных" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'public', label: 'public' },
              { value: 'internal', label: 'internal' },
              { value: 'confidential', label: 'confidential' },
              { value: 'secret', label: 'secret' },
              { value: 'pii', label: 'pii' },
            ]}
          />
        </Form.Item>
        <Form.Item name="decision" label="Решение" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'allow', label: 'allow' },
              { value: 'deny', label: 'deny' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
