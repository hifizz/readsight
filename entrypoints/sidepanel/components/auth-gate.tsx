import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  registerWithEmail,
  signInWithEmail,
  type AuthUser
} from '@/lib/auth';
import { BACKEND } from '@/lib/source-saving';

export function AuthGate({
  onAuthenticated
}: {
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user =
        mode === 'sign-in'
          ? await signInWithEmail(BACKEND, email, password)
          : await registerWithEmail(
              BACKEND,
              email,
              password,
              name.trim() || undefined
            );
      onAuthenticated(user);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '登录失败，请稍后再试。'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background p-5">
      <form
        className="grid w-full max-w-xs gap-3"
        onSubmit={(event) => void submit(event)}
      >
        <div className="mb-2 grid justify-items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <UserRound className="size-4" />
          </span>
          <h1 className="text-base font-semibold">
            {mode === 'sign-in' ? '登录 Relata' : '创建账号'}
          </h1>
        </div>
        {mode === 'register' && (
          <div className="grid gap-1.5">
            <Label htmlFor="auth-name">名称</Label>
            <Input
              id="auth-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="auth-email">邮箱</Label>
          <Input
            id="auth-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="auth-password">密码</Label>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={
              mode === 'sign-in' ? 'current-password' : 'new-password'
            }
            minLength={10}
            required
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? '请稍候…' : mode === 'sign-in' ? '登录' : '创建账号'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() =>
            setMode((current) =>
              current === 'sign-in' ? 'register' : 'sign-in'
            )
          }
        >
          {mode === 'sign-in' ? '没有账号？创建一个' : '已有账号？登录'}
        </Button>
      </form>
    </main>
  );
}
