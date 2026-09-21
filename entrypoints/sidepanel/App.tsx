import { useCallback, useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  getAuthToken,
  getStoredAuthUser,
  refreshAuthUser,
  subscribeAuth
} from '@/lib/auth';
import { BACKEND } from '@/lib/source-saving';
import { AuthGate } from './components/auth-gate';
import { LoadingView } from './components/loading-view';
import { RelataHome } from './RelataHome';
import type { AuthState } from './types';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({ kind: 'loading' });

  const reloadAuth = useCallback(async () => {
    const [token, storedUser] = await Promise.all([
      getAuthToken(),
      getStoredAuthUser()
    ]);
    if (!token) {
      setAuthState({ kind: 'signed-out' });
      return;
    }
    try {
      const user = await refreshAuthUser(BACKEND);
      setAuthState(user ? { kind: 'signed-in', user } : { kind: 'signed-out' });
    } catch {
      setAuthState(
        storedUser
          ? { kind: 'signed-in', user: storedUser }
          : { kind: 'signed-out' }
      );
    }
  }, []);

  useEffect(() => {
    void reloadAuth();
    return subscribeAuth(() => void reloadAuth());
  }, [reloadAuth]);

  return (
    <TooltipProvider>
      {authState.kind === 'loading' && <LoadingView />}
      {authState.kind === 'signed-out' && (
        <AuthGate
          onAuthenticated={(user) => setAuthState({ kind: 'signed-in', user })}
        />
      )}
      {authState.kind === 'signed-in' && (
        <RelataHome
          user={authState.user}
          onSignedOut={() => setAuthState({ kind: 'signed-out' })}
        />
      )}
    </TooltipProvider>
  );
}
