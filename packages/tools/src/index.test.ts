import { describe, it, expect } from 'vitest';
import * as tools from './index.js';

describe('@su10/tools публичный экспорт', () => {
  it('экспонирует Registry + Broker + порты, но НЕ handler-утилиты', () => {
    expect(typeof tools.ToolRegistry).toBe('function');
    expect(typeof tools.ToolBroker).toBe('function');
    expect(typeof tools.hashJson).toBe('function');
    expect(typeof tools.InMemoryToolCallRecorder).toBe('function');
    expect(typeof tools.toToolMetadata).toBe('function');
  });
});
