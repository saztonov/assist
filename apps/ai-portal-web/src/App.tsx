import { ThemeProvider } from '@su10/ui';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './app/AppShell';

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
