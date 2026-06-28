// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    // App renders the Models admin tab which loads data on mount; stub the
    // backend so no real network call escapes the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ models: [], providers: [], policies: [] }),
        text: async () => '',
      })),
    );
  });

  it('renders the portal title', () => {
    render(<App />);
    expect(screen.getByText('AI/Agent Portal')).toBeTruthy();
  });
});
