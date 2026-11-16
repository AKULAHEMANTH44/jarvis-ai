import {
  MemoryCategory,
  MemoryConsentCandidate,
  MemoryEntry,
  MemoryPersistenceResult
} from '../types/assistant';

const MEMORY_STORAGE_KEY = 'jarvis_user_memory_v1';
const MEMORY_SETTINGS_KEY = 'jarvis_user_memory_settings_v1';
const MAX_MEMORY_ENTRIES = 100;

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}/i,
  /\bsk-ant-[A-Za-z0-9_-]{12,}/i,
  /\bAIza[0-9A-Za-z_-]{16,}/,
  /\bghp_[A-Za-z0-9]{16,}/,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
  /\b(?:password|passcode|secret key|private key|api[ _-]?key|access[ _-]?token)\s*(?:is|=|:)\s*\S+/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,16}\b/
];

export function containsSensitiveSecret(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

export class MemoryManager {
  private entries: MemoryEntry[] = [];
  private pendingCandidates: MemoryConsentCandidate[] = [];
  private enabled: boolean = true;
  private sessionCommandCounts: Map<string, number> = new Map();
  private storageKey: string;
  private settingsKey: string;
  private listeners: Set<() => void> = new Set();

  constructor(storageKey = MEMORY_STORAGE_KEY, settingsKey = MEMORY_SETTINGS_KEY) {
    this.storageKey = storageKey;
    this.settingsKey = settingsKey;
    this.loadFromStorage();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const rawSettings = window.localStorage.getItem(this.settingsKey);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) as { enabled?: boolean };
        if (typeof parsed.enabled === 'boolean') {
          this.enabled = parsed.enabled;
        }
      }

      const rawEntries = window.localStorage.getItem(this.storageKey);
      if (rawEntries) {
        const parsed = JSON.parse(rawEntries) as unknown;
        if (Array.isArray(parsed)) {
          this.entries = parsed.filter(
            (e): e is MemoryEntry =>
              Boolean(e) &&
              typeof e.id === 'string' &&
              typeof e.key === 'string' &&
              typeof e.value === 'string' &&
              !containsSensitiveSecret(`${e.key} ${e.value}`)
          );
        }
      }
    } catch {
      // Keep clean empty in-memory state if storage read fails
    }
  }

  private persistEntries(): MemoryPersistenceResult {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {
        ok: false,
        error: 'Persistent browser storage (localStorage) is unavailable in this environment.'
      };
    }
    try {
      const serialized = JSON.stringify(this.entries);
      window.localStorage.setItem(this.storageKey, serialized);
      const verified = window.localStorage.getItem(this.storageKey);
      if (verified !== serialized) {
        return { ok: false, error: 'Storage verification failed after write.' };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to persist memory to localStorage.'
      };
    }
  }

  private persistSettings(): MemoryPersistenceResult {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ok: false, error: 'localStorage unavailable.' };
    }
    try {
      window.localStorage.setItem(this.settingsKey, JSON.stringify({ enabled: this.enabled }));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to persist memory settings.'
      };
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): MemoryPersistenceResult {
    this.enabled = enabled;
    if (!enabled) {
      this.pendingCandidates = [];
    }
    const res = this.persistSettings();
    this.notify();
    return res;
  }

  public getMemories(category?: MemoryCategory): MemoryEntry[] {
    const list = category ? this.entries.filter((e) => e.category === category) : this.entries;
    return list.map((e) => ({ ...e }));
  }

  public getPendingCandidates(): MemoryConsentCandidate[] {
    return this.pendingCandidates.map((c) => ({ ...c }));
  }

  public saveMemory(params: {
    category: MemoryCategory;
    key: string;
    value: string;
    source?: MemoryEntry['source'];
  }): { entry?: MemoryEntry; persistence: MemoryPersistenceResult } {
    if (!this.enabled) {
      return {
        persistence: { ok: false, error: 'Persistent memory is currently disabled by user settings.' }
      };
    }

    const cleanKey = params.key.trim().slice(0, 80);
    const cleanValue = params.value.trim().slice(0, 400);
    if (!cleanKey || !cleanValue) {
      return {
        persistence: { ok: false, error: 'Memory key and value cannot be empty.' }
      };
    }

    if (containsSensitiveSecret(`${cleanKey}: ${cleanValue}`)) {
      return {
        persistence: {
          ok: false,
          error: 'Blocked storing sensitive credential or personal secret in persistent memory.'
        }
      };
    }

    const now = Date.now();
    const existingIdx = this.entries.findIndex(
      (e) => e.category === params.category && e.key.toLowerCase() === cleanKey.toLowerCase()
    );

    const prevEntries = [...this.entries];
    let savedEntry: MemoryEntry;

    if (existingIdx >= 0) {
      savedEntry = {
        ...this.entries[existingIdx],
        value: cleanValue,
        updatedAt: now
      };
      this.entries[existingIdx] = savedEntry;
    } else {
      savedEntry = {
        id: `mem-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        category: params.category,
        key: cleanKey,
        value: cleanValue,
        createdAt: now,
        updatedAt: now,
        source: params.source || 'USER_EXPLICIT'
      };
      this.entries.unshift(savedEntry);
      if (this.entries.length > MAX_MEMORY_ENTRIES) {
        this.entries = this.entries.slice(0, MAX_MEMORY_ENTRIES);
      }
    }

    const persistence = this.persistEntries();
    if (!persistence.ok) {
      // Revert in-memory state if persistence failed so UI/caller never assumes it was saved
      this.entries = prevEntries;
      return { persistence };
    }

    this.notify();
    return { entry: { ...savedEntry }, persistence };
  }

  public updateMemory(
    id: string,
    patch: Partial<Pick<MemoryEntry, 'key' | 'value' | 'category'>>
  ): { entry?: MemoryEntry; persistence: MemoryPersistenceResult } {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) {
      return { persistence: { ok: false, error: 'Memory entry not found.' } };
    }

    const nextKey = (patch.key ?? this.entries[idx].key).trim().slice(0, 80);
    const nextValue = (patch.value ?? this.entries[idx].value).trim().slice(0, 400);
    const nextCategory = patch.category ?? this.entries[idx].category;

    if (!nextKey || !nextValue) {
      return { persistence: { ok: false, error: 'Memory key and value cannot be empty.' } };
    }

    if (containsSensitiveSecret(`${nextKey}: ${nextValue}`)) {
      return {
        persistence: {
          ok: false,
          error: 'Blocked storing sensitive credential or secret in memory.'
        }
      };
    }

    const prevEntries = [...this.entries];
    const updated: MemoryEntry = {
      ...this.entries[idx],
      key: nextKey,
      value: nextValue,
      category: nextCategory,
      updatedAt: Date.now()
    };
    this.entries[idx] = updated;

    const persistence = this.persistEntries();
    if (!persistence.ok) {
      this.entries = prevEntries;
      return { persistence };
    }

    this.notify();
    return { entry: { ...updated }, persistence };
  }

  public deleteMemory(id: string): MemoryPersistenceResult {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) {
      return { ok: false, error: 'Memory entry not found.' };
    }

    const prevEntries = [...this.entries];
    this.entries.splice(idx, 1);

    const persistence = this.persistEntries();
    if (!persistence.ok) {
      this.entries = prevEntries;
      return persistence;
    }

    this.notify();
    return { ok: true };
  }

  public clearAllMemories(): MemoryPersistenceResult {
    const prevEntries = [...this.entries];
    this.entries = [];
    this.pendingCandidates = [];
    const persistence = this.persistEntries();
    if (!persistence.ok) {
      this.entries = prevEntries;
      return persistence;
    }
    this.notify();
    return { ok: true };
  }

  // Proposes a durable memory candidate WITHOUT silently persisting it
  public detectConsentCandidate(userText: string): MemoryConsentCandidate | null {
    if (!this.enabled) return null;
    const trimmed = userText.trim();
    if (!trimmed || containsSensitiveSecret(trimmed)) return null;

    let category: MemoryCategory | null = null;
    let key = '';
    let value = '';
    let reason = '';

    const prefMatch = trimmed.match(/\b(?:i prefer|my preference is|always use|please remember i like)\s+([^.!?\n]{4,100})/i);
    const projectMatch = trimmed.match(/\b(?:i am building|my project is|our project uses|we are building)\s+([^.!?\n]{4,120})/i);
    const explicitRemember = trimmed.match(/\b(?:remember that|save to memory|store note)\s+([^.!?\n]{4,120})/i);

    if (explicitRemember && explicitRemember[1]) {
      category = 'WORKING_CONTEXT';
      key = 'User Note';
      value = explicitRemember[1].trim();
      reason = 'Explicitly asked to remember working context.';
    } else if (prefMatch && prefMatch[1]) {
      category = 'USER_PREFERENCE';
      key = 'Preferred Workflow';
      value = prefMatch[1].trim();
      reason = 'Stated an explicit user preference.';
    } else if (projectMatch && projectMatch[1]) {
      category = 'PROJECT_INFO';
      key = 'Active Project';
      value = projectMatch[1].trim();
      reason = 'Described active project context useful across turns.';
    }

    if (!category || !value) return null;

    const duplicateInSaved = this.entries.some(
      (e) => e.value.toLowerCase() === value.toLowerCase()
    );
    const duplicateInPending = this.pendingCandidates.some(
      (c) => c.value.toLowerCase() === value.toLowerCase()
    );
    if (duplicateInSaved || duplicateInPending) return null;

    const candidate: MemoryConsentCandidate = {
      id: `memcand-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      category,
      key,
      value,
      reason,
      detectedAt: Date.now()
    };

    this.pendingCandidates.unshift(candidate);
    if (this.pendingCandidates.length > 5) {
      this.pendingCandidates = this.pendingCandidates.slice(0, 5);
    }
    this.notify();
    return candidate;
  }

  public recordCommandUsage(commandText: string): MemoryConsentCandidate | null {
    const clean = commandText.trim().toLowerCase();
    if (!clean || clean.length < 3) return null;
    const count = (this.sessionCommandCounts.get(clean) || 0) + 1;
    this.sessionCommandCounts.set(clean, count);

    if (!this.enabled || count !== 3) return null;

    const alreadySaved = this.entries.some(
      (e) => e.category === 'FREQUENT_COMMAND' && e.value.toLowerCase() === clean
    );
    const alreadyPending = this.pendingCandidates.some(
      (c) => c.category === 'FREQUENT_COMMAND' && c.value.toLowerCase() === clean
    );
    if (alreadySaved || alreadyPending) return null;

    const candidate: MemoryConsentCandidate = {
      id: `memcand-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      category: 'FREQUENT_COMMAND',
      key: 'Frequent Command',
      value: commandText.trim(),
      reason: `Executed "${commandText.trim()}" 3 times in this session.`,
      detectedAt: Date.now()
    };
    this.pendingCandidates.unshift(candidate);
    if (this.pendingCandidates.length > 5) {
      this.pendingCandidates = this.pendingCandidates.slice(0, 5);
    }
    this.notify();
    return candidate;
  }

  public approveCandidate(candidateId: string): { entry?: MemoryEntry; persistence: MemoryPersistenceResult } {
    const idx = this.pendingCandidates.findIndex((c) => c.id === candidateId);
    if (idx < 0) {
      return { persistence: { ok: false, error: 'Consent candidate not found.' } };
    }
    const candidate = this.pendingCandidates[idx];
    const result = this.saveMemory({
      category: candidate.category,
      key: candidate.key,
      value: candidate.value,
      source: candidate.category === 'FREQUENT_COMMAND' ? 'COMMAND_FREQ' : 'CONSENT_PROMPT'
    });
    if (result.persistence.ok) {
      this.pendingCandidates.splice(idx, 1);
      this.notify();
    }
    return result;
  }

  public dismissCandidate(candidateId: string) {
    this.pendingCandidates = this.pendingCandidates.filter((c) => c.id !== candidateId);
    this.notify();
  }

  public getRelevantMemories(query: string, limit = 5): MemoryEntry[] {
    if (!this.enabled || this.entries.length === 0) return [];
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length >= 3);

    const scored = this.entries.map((entry) => {
      const hay = `${entry.category} ${entry.key} ${entry.value}`.toLowerCase();
      let score = entry.category === 'PROJECT_INFO' || entry.category === 'USER_PREFERENCE' ? 1 : 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += 3;
      }
      return { entry, score };
    });

    return scored
      .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
      .slice(0, Math.max(1, limit))
      .map((s) => ({ ...s.entry }));
  }

  public formatMemoryContext(query: string): string {
    const relevant = this.getRelevantMemories(query, 6);
    if (relevant.length === 0) return 'None stored.';
    return relevant.map((m) => `- [${m.category}] ${m.key}: ${m.value}`).join('\n');
  }
}

export const memoryManager = new MemoryManager();
