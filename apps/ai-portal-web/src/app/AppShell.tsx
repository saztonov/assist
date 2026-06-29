/**
 * Оболочка портала: AntD Layout (Sider + Header + Content). Навигация между 8
 * разделами — через локальное состояние (без react-router). Гейтинг по auth:
 * пока пользователь не аутентифицирован — показывается LoginScreen.
 */
import { useState } from 'react';
import { Button, Layout, Menu, Space, Spin, Typography } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/useAuth';
import { LoginScreen } from './LoginScreen';
import { SECTIONS, DEFAULT_SECTION } from './sections';

const { Header, Sider, Content } = Layout;

export function AppShell(): JSX.Element {
  const { status, user, logout, mode } = useAuth();
  const [active, setActive] = useState<string>(DEFAULT_SECTION);

  if (status === 'loading') {
    return (
      <Layout style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </Layout>
    );
  }
  if (status === 'unauthenticated') return <LoginScreen />;

  const section = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={220} theme="light">
        <div style={{ padding: '16px', fontWeight: 600 }}>AI/Agent Portal</div>
        <Menu
          mode="inline"
          selectedKeys={[active]}
          onClick={(e) => setActive(e.key)}
          items={SECTIONS.map((s) => ({ key: s.key, icon: s.icon, label: s.label }))}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 16,
          }}
        >
          <Typography.Text strong>{section.label}</Typography.Text>
          <Space>
            <Typography.Text type="secondary">
              {user?.name ?? user?.email ?? user?.sub ?? (mode === 'dev' ? 'dev' : '—')}
            </Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              Выход
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 16 }}>{section.element}</Content>
      </Layout>
    </Layout>
  );
}
