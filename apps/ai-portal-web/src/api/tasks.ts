/** Типизированный доступ к /agent/tasks (только backend `/api/v1`). */
import { api } from './client';

export interface TaskSummary {
  id: string;
  status: string;
  title: string | null;
  taskType: string | null;
  workflowId: string | null;
  createdBy: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCard extends TaskSummary {
  templateId: string | null;
  sourcePortal: string | null;
  departmentId: string | null;
  projectId: string | null;
  resultJson: unknown;
}

export interface TaskEvent {
  id: string;
  eventType: string;
  status: string | null;
  message: string | null;
  dataJson: unknown;
  createdAt: string;
}

export interface ListTasksResponse {
  items: TaskSummary[];
  nextCursor?: string;
}

export const tasksApi = {
  list: (params?: { status?: string; cursor?: string; limit?: number }): Promise<ListTasksResponse> => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.cursor) q.set('cursor', params.cursor);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get<ListTasksResponse>(`/agent/tasks${qs ? `?${qs}` : ''}`);
  },
  get: (id: string): Promise<TaskCard> => api.get<TaskCard>(`/agent/tasks/${id}`),
  events: (id: string): Promise<{ items: TaskEvent[] }> =>
    api.get<{ items: TaskEvent[] }>(`/agent/tasks/${id}/events`),
  cancel: (id: string): Promise<TaskCard> => api.post<TaskCard>(`/agent/tasks/${id}/cancel`),
};
