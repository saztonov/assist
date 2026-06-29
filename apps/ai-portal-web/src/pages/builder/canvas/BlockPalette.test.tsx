// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BlockPalette } from './BlockPalette';
import { BASE_BLOCKS, mergeLiveTools } from '../catalog';

afterEach(() => cleanup());

describe('BlockPalette', () => {
  it('renders base block labels', () => {
    const { catalog } = mergeLiveTools(BASE_BLOCKS, []);
    render(<BlockPalette catalog={catalog} onAdd={() => {}} />);
    expect(screen.getByText('Manual Trigger')).toBeTruthy();
    expect(screen.getByText('RAG Search')).toBeTruthy();
    expect(screen.getByText('Notify User')).toBeTruthy();
  });

  it('includes a live tool not covered by a base block', () => {
    const { catalog } = mergeLiveTools(BASE_BLOCKS, [
      {
        name: 'custom.tool',
        version: 1,
        description: 'custom',
        category: 'system',
        riskLevel: 'low',
        requiresApproval: false,
        timeoutMs: 1000,
        inputSchema: {},
        outputSchema: {},
        checksum: 'x',
      },
    ]);
    render(<BlockPalette catalog={catalog} onAdd={() => {}} />);
    expect(screen.getByText('custom.tool')).toBeTruthy();
  });
});
