import { Tabs, Typography } from 'antd';
import { ThemeProvider } from '@su10/ui';
import { ModelsPage } from './pages/admin/ModelsPage';
import { BuilderPage } from './pages/builder/BuilderPage';

export function App() {
  return (
    <ThemeProvider>
      <Typography.Title level={3}>AI/Agent Portal</Typography.Title>
      <Tabs
        items={[
          { key: 'builder', label: 'Конструктор', children: <BuilderPage /> },
          { key: 'models', label: 'Модели (admin)', children: <ModelsPage /> },
        ]}
      />
    </ThemeProvider>
  );
}
