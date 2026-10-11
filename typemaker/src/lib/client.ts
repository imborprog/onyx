"use client";

// Browser-side helpers. The workspace secret is the creator's private key to
// their dashboard; we remember it locally so "내 테스트" works without accounts.

const KEY = "typemaker.workspace";

export function getSavedWorkspace(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveWorkspace(secret: string): void {
  try {
    window.localStorage.setItem(KEY, secret);
  } catch {
    /* private mode: the URL itself still works */
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; workspace?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.workspace) headers["x-workspace"] = init.workspace;
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data;
}

let memorySessionId: string | null = null;

/** Random per-tab id. Without sessionStorage (some private modes) it lives for this page load only, never a shared constant. */
export function sessionId(): string {
  const k = "typemaker.sid";
  const fresh = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    const existing = window.sessionStorage.getItem(k);
    if (existing) return existing;
    const id = fresh();
    window.sessionStorage.setItem(k, id);
    return id;
  } catch {
    memorySessionId ??= fresh();
    return memorySessionId;
  }
}
