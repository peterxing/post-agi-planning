import type { TechTreeState } from './types';

const LOCAL_USER_KEY = 'rehoboam-user-instance';
export class SupabaseRestError extends Error {
  code?: string;
  details?: string | null;
  hint?: string | null;

  constructor(message: string, code?: string, details?: string | null, hint?: string | null) {
    super(message);
    this.name = 'SupabaseRestError';
    this.code = code;
    this.details = details ?? null;
    this.hint = hint ?? null;
  }
}

interface SupabaseConfig {
  url: string;
  anonKey: string;
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
  const resolvedUrl = url || 'https://kpcdcpnwvemeqedtvnsd.supabase.co';
  const resolvedKey =
    anonKey || 'sb_publishable_MNUopX7S_p-eaTnKcQ8a2g_1nZdZU1i';

  if (!resolvedUrl || !resolvedKey) return null;
  return { url: resolvedUrl, anonKey: resolvedKey };
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
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
  };
}

async function parseSupabaseError(response: Response): Promise<SupabaseRestError> {
  let message = 'Supabase request failed';
  let code: string | undefined;
  let details: string | null | undefined;
  let hint: string | null | undefined;

  try {
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text) as {
          message?: string;
          code?: string;
          details?: string | null;
          hint?: string | null;
          error?: string;
        };
        message = json.message || json.error || message;
        code = json.code;
        details = json.details;
        hint = json.hint;
      } catch {
        message = text;
      }
    }
  } catch {
    message = response.statusText || message;
  }

  return new SupabaseRestError(message, code, details, hint);
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
    throw await parseSupabaseError(response);
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
    throw await parseSupabaseError(response);
  }
}
