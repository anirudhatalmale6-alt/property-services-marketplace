import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On boot, ask the server who we are. The cookie may still be valid from a
  // previous visit, so this is what keeps a refresh from logging you out.
  useEffect(() => {
    let cancelled = false;
    api.auth
      .me()
      .then((r) => !cancelled && setUser(r.user))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.auth.login(email, password);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (payload) => {
    const r = await api.auth.register(payload);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => {});
    setUser(null);
  }, []);

  /** Re-read the user, e.g. after a provider's approval status changes. */
  const reload = useCallback(async () => {
    const r = await api.auth.me().catch(() => null);
    setUser(r?.user ?? null);
    return r?.user ?? null;
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, reload, setUser }),
    [user, loading, login, register, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where each role belongs when they land on the app. */
export const homeFor = (user) => {
  if (!user) return '/';
  if (user.role === 'ADMIN') return '/admin';
  if (user.role === 'PROVIDER') {
    return user.provider?.status === 'APPROVED' ? '/provider/jobs' : '/provider/onboarding';
  }
  return '/orders';
};
