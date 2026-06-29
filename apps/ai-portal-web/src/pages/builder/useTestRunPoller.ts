/**
 * Опрос статуса задачи тест-прогона: GET /agent/tasks/:id (+ /events) с остановкой
 * на терминальном статусе. Сеть — только через `api`-клиент. Чистится в cleanup.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { TERMINAL_STATUSES, type TaskCard, type TaskEvent } from './types';

export interface TestRunPollState {
  task: TaskCard | null;
  events: TaskEvent[];
  polling: boolean;
}

export function useTestRunPoller(taskId: string | null, intervalMs = 2000): TestRunPollState {
  const [task, setTask] = useState<TaskCard | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setEvents([]);
      setPolling(false);
      return;
    }
    let active = true;
    setPolling(true);
    const handle: { id?: ReturnType<typeof setInterval> } = {};

    const stop = (): void => {
      if (handle.id) clearInterval(handle.id);
      setPolling(false);
    };

    const tick = async (): Promise<void> => {
      try {
        const [card, evs] = await Promise.all([
          api.get<TaskCard>(`/agent/tasks/${taskId}`),
          api.get<{ items: TaskEvent[] }>(`/agent/tasks/${taskId}/events`),
        ]);
        if (!active) return;
        setTask(card);
        setEvents(evs.items);
        if (TERMINAL_STATUSES.includes(card.status)) stop();
      } catch {
        // временная ошибка сети — продолжаем опрос
      }
    };

    void tick();
    handle.id = setInterval(() => void tick(), intervalMs);
    return () => {
      active = false;
      if (handle.id) clearInterval(handle.id);
    };
  }, [taskId, intervalMs]);

  return { task, events, polling };
}
