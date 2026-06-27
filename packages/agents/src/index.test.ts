import { describe, it, expect } from 'vitest';
import { echoAgent } from './index.js';

describe('agents', () => {
  it('echo agent returns output derived from the prompt', async () => {
    const r = await echoAgent.invoke({ prompt: 'hello' });
    expect(r.output).toContain('hello');
  });
});
