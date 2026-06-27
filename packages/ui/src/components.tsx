import { ConfigProvider, type ThemeConfig } from 'antd';
import type { ReactNode } from 'react';
import { tokens } from './theme.js';

export const themeConfig: ThemeConfig = {
  token: { colorPrimary: tokens.colorPrimary, borderRadius: tokens.borderRadius },
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={themeConfig}>{children}</ConfigProvider>;
}
