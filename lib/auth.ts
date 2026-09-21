export const AUTH_TOKEN_KEY = 'relata:auth-token';
export const AUTH_USER_KEY = 'relata:auth-user';

export interface AuthUser { id: string; email: string; name: string }

export async function getAuthToken(): Promise<string | null> {
  const values = await chrome.storage.local.get(AUTH_TOKEN_KEY);
  const token = values[AUTH_TOKEN_KEY];
  return typeof token === 'string' && token ? token : null;
}

export async function getStoredAuthUser(): Promise<AuthUser | null> {
  const values = await chrome.storage.local.get(AUTH_USER_KEY);
  const user = values[AUTH_USER_KEY] as AuthUser | undefined;
  return user?.id && user.email ? user : null;
}

export async function storeAuth(token: string, user: AuthUser): Promise<void> {
  await chrome.storage.local.set({ [AUTH_TOKEN_KEY]: token, [AUTH_USER_KEY]: user });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
}

export async function authHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra);
  const token = await getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, { ...init, headers: await authHeaders(init.headers) });
  if (response.status === 401) await clearAuth();
  return response;
}

async function readAuthResponse(response: Response): Promise<{ user: AuthUser; token: string }> {
  const data = (await response.json().catch(() => null)) as { user?: AuthUser } | null;
  if (!response.ok || !data?.user) {
    throw new Error(response.status === 429 ? '尝试次数过多，请稍后再试' : '邮箱或密码错误');
  }
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('登录凭证未返回，请重试');
  return { user: data.user, token };
}

export async function signInWithEmail(backendUrl: string, email: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${backendUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const result = await readAuthResponse(response);
  await storeAuth(result.token, result.user);
  return result.user;
}

export async function registerWithEmail(
  backendUrl: string,
  email: string,
  password: string,
  name?: string,
): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  const response = await fetch(`${backendUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalized,
      password,
      name: name?.trim() || normalized.split('@')[0] || 'Relata user',
    }),
  });
  const result = await readAuthResponse(response);
  await storeAuth(result.token, result.user);
  return result.user;
}

export async function refreshAuthUser(backendUrl: string): Promise<AuthUser | null> {
  if (!(await getAuthToken())) return null;
  const response = await authFetch(`${backendUrl}/api/auth/get-session`);
  if (!response.ok) return null;
  const data = (await response.json()) as { user?: AuthUser } | null;
  if (!data?.user) {
    await clearAuth();
    return null;
  }
  await chrome.storage.local.set({ [AUTH_USER_KEY]: data.user });
  return data.user;
}

export async function signOut(backendUrl: string): Promise<void> {
  try {
    await authFetch(`${backendUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } finally {
    await clearAuth();
  }
}

export function subscribeAuth(callback: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => {
    // User profile refreshes write AUTH_USER_KEY; listening to that key would
    // recursively call get-session until the auth rate limit is exhausted.
    if (area === 'local' && changes[AUTH_TOKEN_KEY]) callback();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
