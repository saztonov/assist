import { Button, Typography } from 'antd';
import { ThemeProvider } from '@su10/ui';
import { WorkflowTemplateSchema } from '@su10/workflow-schema';
import { getPublicConfig } from '@su10/config/public';

const cfg = getPublicConfig(import.meta.env as Record<string, string | undefined>);

export function App() {
  // Visual Builder placeholder: it VALIDATES (does not execute) a WorkflowTemplate.
  // Persistence happens via the backend API at cfg.VITE_API_BASE_URL.
  const sample = WorkflowTemplateSchema.safeParse({ id: 't1', name: 'Sample template' });

  return (
    <ThemeProvider>
      <Typography.Title level={3}>AI/Agent Portal</Typography.Title>
      <Typography.Paragraph>API base: {cfg.VITE_API_BASE_URL}</Typography.Paragraph>
      <Button type="primary">Template valid: {String(sample.success)}</Button>
    </ThemeProvider>
  );
}
