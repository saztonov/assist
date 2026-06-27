import { Card } from 'antd';
import type { AgentApiClient } from './api-client.js';

export function TaskStatusWidget({ taskId }: { apiClient: AgentApiClient; taskId: string }) {
  return <Card title="Task status">{taskId}</Card>;
}

export function AgentChatWidget(_props: { apiClient: AgentApiClient }) {
  return <Card title="Agent chat">…</Card>;
}
