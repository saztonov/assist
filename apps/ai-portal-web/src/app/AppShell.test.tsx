// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@su10/ui';
import { AuthProvider } from '../auth/AuthProvider';
import { AppShell } from './AppShell';

function renderShell(): void {
  render(
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe('AppShell (dev-режим)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })));
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('без токена показывает экран входа (dev-режим)', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByText('Применить токен')).toBeTruthy());
  });

  it('с dev-токеном рендерит все 8 разделов', async () => {
    localStorage.setItem('dev_token', 'eyJ.dev.token');
    renderShell();
    const labels = ['Чат', 'Мои задачи', 'Шаблоны', 'Документы', 'Подключения', 'Approvals', 'Артефакты', 'Администрирование'];
    for (const label of labels) {
      await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
    }
    // Кнопка выхода присутствует.
    expect(screen.getByText('Выход')).toBeTruthy();
  });
});
