// Chat UI-continuity cache (browser-local).
//
// Mission Control chat state is component-local and is lost when the user
// navigates to another workspace section and the Chat page unmounts. This cache
// persists, per agent, the last-seen turns and the active agent selection in
// localStorage so returning to chat rehydrates the prior conversation instantly
// and switching agents never wipes another agent's chat.
//
// This is temporary UI continuity only, NOT the system of record. The backend
// conversation log remains authoritative; cached turns are shown immediately on
// mount and then reconciled with the backend fetch. Completed messages survive a
// failed stream because they are written through to this cache as they arrive.

const ACTIVE_AGENT_KEY = 'cc.chat.activeAgent';
const TURNS_PREFIX = 'cc.chat.turns.';
const MAX_CACHED_TURNS = 100;

export interface CachedTurn {
  role: 'user' | 'assistant';
  content: string;
  source?: string;
  created_at?: number;
  photoUrl?: string;
  photoCaption?: string;
}

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage may be unavailable or full; UI continuity is best-effort */
  }
}

function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadActiveAgent(fallback = 'all'): string {
  const v = safeGet(ACTIVE_AGENT_KEY);
  return v && v.trim() ? v : fallback;
}

export function saveActiveAgent(agentId: string): void {
  safeSet(ACTIVE_AGENT_KEY, agentId);
}

export function loadCachedTurns(agentId: string): CachedTurn[] {
  const raw = safeGet(TURNS_PREFIX + agentId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CachedTurn[]) : [];
  } catch {
    return [];
  }
}

export function saveCachedTurns(agentId: string, turns: CachedTurn[]): void {
  // Keep only the tail so the cache stays small and within quota.
  const tail = turns.length > MAX_CACHED_TURNS ? turns.slice(-MAX_CACHED_TURNS) : turns;
  safeSet(TURNS_PREFIX + agentId, JSON.stringify(tail));
}

export function clearCachedTurns(agentId: string): void {
  safeRemove(TURNS_PREFIX + agentId);
}
