/** Чат: список сессий + тред сообщений + отправка (ответ mock-агента). */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, List, Space, Spin, Typography } from 'antd';
import { chatApi, type ChatMessage, type ChatSession } from '../../api/chat';

export function ChatPage(): JSX.Element {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await chatApi.listSessions();
      setSessions(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    try {
      const res = await chatApi.getSession(id);
      setMessages(res.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const newSession = useCallback(async () => {
    try {
      const s = await chatApi.createSession();
      await loadSessions();
      setActiveId(s.id);
      setMessages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadSessions]);

  const send = useCallback(async () => {
    if (!activeId || !draft.trim()) return;
    setSending(true);
    try {
      const res = await chatApi.postMessage(activeId, draft.trim());
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [activeId, draft]);

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <Card
        title="Сессии"
        size="small"
        style={{ width: 260, flexShrink: 0 }}
        extra={
          <Button size="small" type="primary" onClick={() => void newSession()}>
            Новая
          </Button>
        }
      >
        <List<ChatSession>
          dataSource={sessions}
          locale={{ emptyText: <Empty description="Нет сессий" /> }}
          renderItem={(s) => (
            <List.Item
              onClick={() => void openSession(s.id)}
              style={{ cursor: 'pointer', background: s.id === activeId ? '#f0f5ff' : undefined }}
            >
              <Typography.Text ellipsis>{s.title ?? `Сессия ${s.id.slice(0, 8)}`}</Typography.Text>
            </List.Item>
          )}
        />
      </Card>

      <Card size="small" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {error && (
          <Alert type="error" closable style={{ marginBottom: 8 }} message={error} onClose={() => setError(null)} />
        )}
        {!activeId ? (
          <Empty description="Выберите или создайте сессию" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ minHeight: 240 }}>
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{ textAlign: m.role === 'user' ? 'right' : 'left', margin: '6px 0' }}
                >
                  <Typography.Text
                    style={{
                      display: 'inline-block',
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: m.role === 'user' ? '#1677ff' : '#f0f0f0',
                      color: m.role === 'user' ? '#fff' : undefined,
                    }}
                  >
                    {m.content}
                  </Typography.Text>
                </div>
              ))}
              {sending && <Spin size="small" />}
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={() => void send()}
                placeholder="Сообщение агенту..."
                disabled={sending}
              />
              <Button type="primary" onClick={() => void send()} loading={sending} disabled={!draft.trim()}>
                Отправить
              </Button>
            </Space.Compact>
          </Space>
        )}
      </Card>
    </div>
  );
}
