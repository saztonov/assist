/** Design-system tokens. Pure data — no React/antd imports (browser-safe). */
export const tokens = {
  colorPrimary: '#1677ff',
  borderRadius: 6,
} as const;

export type Tokens = typeof tokens;
