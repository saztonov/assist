import { Button, Tabs, Typography } from 'antd';
import { ThemeProvider } from '@su10/ui';
import { WorkflowTemplateSchema } from '@su10/workflow-schema';
import { getPublicConfig } from '@su10/config/public';
import { ModelsPage } from './pages/admin/ModelsPage';

const cfg = getPublicConfig(import.meta.env as Record<string, string | undefined>);

function BuilderPlaceholder(): JSX.Element {
  // Visual Builder placeholder: it VALIDATES (does not execute) a WorkflowTemplate.
  // Persistence happens via the backend API at cfg.VITE_API_BASE_URL.
  const sample = WorkflowTemplateSchema.safeParse({ id: 't1', name: 'Sample template' });
  return (
    <>
      <Typography.Paragraph>API base: {cfg.VITE_API_BASE_URL}</Typography.Paragraph>
      <Button type="primary">Template valid: {String(sample.success)}</Button>
    </>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <Typography.Title level={3}>AI/Agent Portal</Typography.Title>
      <Tabs
        items={[
          { key: 'builder', label: 'Конструктор', children: <BuilderPlaceholder /> },
          { key: 'models', label: 'Модели (admin)', children: <ModelsPage /> },
        ]}
      />
    </ThemeProvider>
  );
}
