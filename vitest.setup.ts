/**
 * Shared test setup. Polyfills browser APIs that jsdom omits but Ant Design uses
 * (e.g. `window.matchMedia` for responsive components). Guarded so it is a no-op
 * in the default `node` environment.
 */
if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  // jsdom throws "Not implemented" when getComputedStyle is called with a
  // pseudo-element (Ant Design does this while measuring). Drop the pseudo arg.
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((elt: Element) =>
    realGetComputedStyle(elt)) as typeof window.getComputedStyle;

  // React Flow (@xyflow/react) measures with ResizeObserver, which jsdom omits.
  // Minimal no-op stub keeps smoke tests deterministic (no layout geometry).
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  }
}
