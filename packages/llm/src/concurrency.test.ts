import { describe, it, expect } from 'vitest';
import { Semaphore } from './concurrency.js';

describe('Semaphore', () => {
  it('limits concurrency to the configured max', async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let peak = 0;
    const task = () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
      });
    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });

  it('allows up to max in parallel', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
      });
    await Promise.all([task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  it('releases the permit even if the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // A subsequent task must still acquire the freed permit.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects an invalid max', () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
