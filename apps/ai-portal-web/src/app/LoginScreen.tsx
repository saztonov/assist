/**
 * Экран входа. В OIDC-режиме — кнопка «Войти через Keycloak». В dev-режиме —
 * поле для вставки dev-токена (local-first, реальный Keycloak не требуется).
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Space, Typography } from 'antd';
import { useAuth } from '../auth/useAuth';

export function LoginScreen(): JSX.Element {
  const { mode, login, setDevTokenValue } = useAuth();
  const [token, setToken] = useState('');

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: 420 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            AI/Agent Portal
          </Typography.Title>
          {mode === 'oidc' ? (
            <>
              <Typography.Paragraph>Войдите через корпоративный Keycloak.</Typography.Paragraph>
              <Button type="primary" block onClick={login}>
                Войти через Keycloak
              </Button>
            </>
          ) : (
            <>
              <Typography.Paragraph type="secondary">
                Локальный режим разработки. Вставьте dev-токен (mint-dev-token).
              </Typography.Paragraph>
              <Input.TextArea
                rows={4}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="eyJ..."
              />
              <Button type="primary" block disabled={!token.trim()} onClick={() => setDevTokenValue(token.trim())}>
                Применить токен
              </Button>
            </>
          )}
        </Space>
      </Card>
    </Flex>
  );
}
