import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './AuthProvider';

/** Доступ к контексту аутентификации. Бросает, если вызван вне AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
