import type { TechTreeState } from './types';

const LOCAL_USER_KEY = 'rehoboam-user-instance';
const SUPABASE_AUTH_TOKEN_KEY = 'rehoboam-supabase-auth-token';
const SUPABASE_AUTH_USER_KEY = 'rehoboam-supabase-user-id';

interface SupabaseConfig {
  url: string;
  anonKey: string;
  oauthProvider?: string;
}

interface TechTreeStateRow {
  user_id: string;
  node_id: string;
  status: TechTreeState['status'];
  effective_year?: number | null;
  effective_month?: number | null;
  updated_at?: string | number | null;
}

const ensureWindow = () => (typeof window === 'undefined' ? null : window as any);

export function getSupabaseConfig(): SupabaseConfig | null {
  const w = ensureWindow();
  const url =
    import.meta?.env?.VITE_SUPABASE_URL ||
    import.meta?.env?.NEXT_PUBLIC_SUPABASE_URL ||
    w?.env?.SUPABASE_URL ||
    w?.env?.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    import.meta?.env?.VITE_SUPABASE_ANON_KEY ||
    import.meta?.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    w?.env?.SUPABASE_ANON_KEY ||
    w?.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  const oauthProvider =
    import.meta?.env?.VITE_SUPABASE_OAUTH_PROVIDER ||
    import.meta?.env?.NEXT_PUBLIC_SUPABASE_OAUTH_PROVIDER ||
    w?.env?.SUPABASE_OAUTH_PROVIDER ||
    w?.env?.NEXT_PUBLIC_SUPABASE_OAUTH_PROVIDER ||
    'github';

  const resolvedUrl = url || 'https://kpcdcpnwvemeqedtvnsd.supabase.co';
  const resolvedKey =
    anonKey || 'sb_publishable_MNUopX7S_p-eaTnKcQ8a2g_1nZdZU1i';

  if (!resolvedUrl || !resolvedKey) return null;
  return { url: resolvedUrl, anonKey: resolvedKey, oauthProvider };
}

export function getUserInstanceId(): string | null {
  const w = ensureWindow();
  if (!w) return null;

  const sparkUser = w.spark?.user;
  if (sparkUser?.id) return `spark-${sparkUser.id}`;
  if (sparkUser?.login) return `spark-login-${sparkUser.login}`;

  try {
    const existing = w.localStorage?.getItem(LOCAL_USER_KEY);
    if (existing) return existing;

    const fallback = `local-${(w.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))}`;
    w.localStorage?.setItem(LOCAL_USER_KEY, fallback);
    return fallback;
  } catch {
    return `local-${Math.random().toString(36).slice(2)}`;
  }
}

export function consumeSupabaseOAuthRedirect(): boolean {
  const w = ensureWindow();
  if (!w?.location?.hash) return false;

  const params = new URLSearchParams(w.location.hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  if (!accessToken) return false;

  const expiresIn = params.get('expires_in');
  const tokenType = params.get('token_type') || undefined;
  const refreshToken = params.get('refresh_token') || undefined;
  const expiresAt = expiresIn ? Date.now() + Number(expiresIn) * 1000 : undefined;

  const session = {
    accessToken,
    tokenType,
    refreshToken,
    expiresAt,
  };

  try {
    w.localStorage?.setItem(SUPABASE_AUTH_TOKEN_KEY, JSON.stringify(session));
  } catch {
    return false;
  }

  w.history?.replaceState?.(null, '', w.location.pathname + w.location.search);
  return true;
}

export function getSupabaseAuthSession(): {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  expiresAt?: number;
} | null {
  const w = ensureWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage?.getItem(SUPABASE_AUTH_TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSupabaseAuthSession(): void {
  const w = ensureWindow();
  if (!w) return;
  try {
    w.localStorage?.removeItem(SUPABASE_AUTH_TOKEN_KEY);
    w.localStorage?.removeItem(SUPABASE_AUTH_USER_KEY);
  } catch {
    return;
  }
}

export function getSupabaseAuthUserId(): string | null {
  const w = ensureWindow();
  if (!w) return null;
  try {
    return w.localStorage?.getItem(SUPABASE_AUTH_USER_KEY);
  } catch {
    return null;
  }
}

export async function refreshSupabaseAuthUserId(
  config: SupabaseConfig
): Promise<string | null> {
  const session = getSupabaseAuthSession();
  if (!session?.accessToken) return null;
  if (session.expiresAt && session.expiresAt <= Date.now()) {
    clearSupabaseAuthSession();
    return null;
  }

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { id?: string };
  if (!data?.id) return null;

  const w = ensureWindow();
  try {
    w?.localStorage?.setItem(SUPABASE_AUTH_USER_KEY, data.id);
  } catch {
    return data.id;
  }

  return data.id;
}

export function getSupabaseOAuthUrl(config: SupabaseConfig, redirectTo?: string): string {
  const w = ensureWindow();
  const redirect = redirectTo || w?.location?.href || '';
  const provider = config.oauthProvider || 'github';
  const params = new URLSearchParams({
    provider,
    redirect_to: redirect,
    response_type: 'token',
  });
  return `${config.url}/auth/v1/authorize?${params.toString()}`;
}

export function startSupabaseOAuth(config: SupabaseConfig, redirectTo?: string): void {
  const w = ensureWindow();
  if (!w) return;
  const url = getSupabaseOAuthUrl(config, redirectTo);
  w.location.assign(url);
}

function mapRowToState(row: TechTreeStateRow): TechTreeState {
  return {
    nodeId: row.node_id,
    status: row.status,
    effectiveYear: row.effective_year ?? undefined,
    effectiveMonth: row.effective_month ?? undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

function getSupabaseAuthHeaders(config: SupabaseConfig): Record<string, string> {
  const session = getSupabaseAuthSession();
  if (session?.accessToken && (!session.expiresAt || session.expiresAt > Date.now())) {
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
    };
  }

  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
  };
}

export async function fetchTechTreeStates(
  config: SupabaseConfig,
  userId: string
): Promise<TechTreeState[]> {
  const response = await fetch(
    `${config.url}/rest/v1/tech_tree_states?user_id=eq.${encodeURIComponent(userId)}&select=node_id,status,effective_year,effective_month,updated_at`,
    {
      headers: {
        ...getSupabaseAuthHeaders(config),
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to load saved selections');
  }

  const rows = (await response.json()) as TechTreeStateRow[];
  return rows.map(mapRowToState);
}

export async function upsertTechTreeState(
  config: SupabaseConfig,
  userId: string,
  state: TechTreeState
): Promise<void> {
  const payload = [{
    user_id: userId,
    node_id: state.nodeId,
    status: state.status,
    effective_year: state.effectiveYear ?? null,
    effective_month: state.effectiveMonth ?? null,
    updated_at: new Date(state.updatedAt).toISOString(),
  }];

  const response = await fetch(`${config.url}/rest/v1/tech_tree_states`, {
    method: 'POST',
    headers: {
      ...getSupabaseAuthHeaders(config),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to save selection');
  }
}
