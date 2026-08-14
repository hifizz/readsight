import { auth } from '@/lib/auth';

export type CurrentUser = { id: string; email: string; name: string };

export async function getCurrentUser(req: Request): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function requireUser(req: Request): Promise<
  | { ok: true; user: CurrentUser }
  | { ok: false; response: Response }
> {
  const user = await getCurrentUser(req);
  if (user) return { ok: true, user };
  return {
    ok: false,
    response: Response.json(
      { error: 'unauthorized', message: 'Sign in is required.' },
      { status: 401 },
    ),
  };
}
