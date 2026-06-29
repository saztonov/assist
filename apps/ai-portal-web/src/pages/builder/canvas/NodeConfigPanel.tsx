/** Правая панель: редактирование label и params выбранного узла по paramFields. */
import { Button, Empty, Form, Input, InputNumber, Select, Switch, Typography } from 'antd';
import type { BlockDef, ParamField } from '../catalog';
import type { WorkflowEditorApi } from '../useWorkflowEditor';

function ParamControl({
  field,
  value,
  onChange,
}: {
  field: ParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}): JSX.Element {
  switch (field.kind) {
    case 'number':
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={typeof value === 'number' ? value : undefined}
          onChange={(v) => onChange(v)}
        />
      );
    case 'switch':
      return <Switch checked={Boolean(value)} onChange={(v) => onChange(v)} />;
    case 'select':
      return (
        <Select
          style={{ width: '100%' }}
          value={value as string | undefined}
          options={field.options ?? []}
          onChange={(v) => onChange(v)}
          allowClear
        />
      );
    case 'textarea':
      return (
        <Input.TextArea
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function NodeConfigPanel({
  editor,
  catalog,
}: {
  editor: WorkflowEditorApi;
  catalog: BlockDef[];
}): JSX.Element {
  const node = editor.selectedNode;
  if (!node) {
    return <Empty description="Выберите узел" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  const block = catalog.find((b) => b.key === node.data.catalogKey);
  const fields = block?.paramFields ?? [];
  const params = node.data.params;

  const setParam = (name: string, value: unknown): void => {
    const next = { ...params };
    if (value === undefined || value === null || value === '') delete next[name];
    else next[name] = value;
    editor.updateNode(node.id, { params: next });
  };

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {block?.label ?? node.data.nodeType}
      </Typography.Title>
      <Form layout="vertical" size="small">
        <Form.Item label="Название узла">
          <Input
            value={node.data.label ?? ''}
            onChange={(e) => editor.updateNode(node.id, { label: e.target.value })}
          />
        </Form.Item>
        {fields.map((field) => (
          <Form.Item
            key={field.name}
            label={field.label}
            required={field.required}
            validateStatus={field.required && !params[field.name] ? 'warning' : undefined}
          >
            <ParamControl
              field={field}
              value={params[field.name]}
              onChange={(v) => setParam(field.name, v)}
            />
          </Form.Item>
        ))}
        <Button danger size="small" onClick={() => editor.removeNode(node.id)}>
          Удалить узел
        </Button>
      </Form>
    </div>
  );
}
