import {
  ConversationSessionSummary,
  ConversationTurn,
  IntentCategory,
  WorkspaceContextSnapshot
} from '../types/assistant';

export interface FollowUpResolution {
  originalInput: string;
  expandedQuery: string;
  isFollowUp: boolean;
  resolvedReferences: string[];
  inferredSubject?: string;
}

interface SessionBucket {
  id: string;
  topic: string;
  activeSubjects: string[];
  turns: ConversationTurn[];
  rollingSummary: string;
  createdAt: number;
  updatedAt: number;
}

const MAX_TURNS_PER_SESSION = 30;
const MAX_HISTORY_CHARS = 9000;

function extractSubjectPhrase(text: string): string | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const patterns = [
    /(?:building|working on|developing|creating|debugging|designing|inspecting|explaining)\s+(?:a|an|the|my)?\s*([^.,!?;]{3,60})/i,
    /(?:project|system|module|model|subsystem|component)\s*(?:is|called|named|:)?\s*([^.,!?;]{3,60})/i,
    /(?:about|regarding|for)\s+(?:the|my|this)?\s*([^.,!?;]{3,50})/i
  ];

  for (const re of patterns) {
    const match = cleaned.match(re);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function isShortFragmentOrFollowUp(text: string): boolean {
  const lower = text.trim().toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  const pronounOrDeictic =
    /\b(it|its|that|this|those|these|them|there|the model|the object|the imported model|the subsystem|the component|the project|the voice system|same|more|continue|elaborate|explain that|why|how so)\b/i.test(
      lower
    );

  // Short noun-phrase reply such as "The voice system." or "Yes, that one."
  if (wordCount <= 6 && !/^(hello|hi|hey|status|diagnostics|undo|redo|help)\b/i.test(lower)) {
    return true;
  }

  return pronounOrDeictic;
}

export class ConversationManager {
  private sessions: Map<string, SessionBucket> = new Map();
  private currentSessionId: string;
  private maxTurnsPerSession: number;

  constructor(maxTurnsPerSession = MAX_TURNS_PER_SESSION) {
    this.maxTurnsPerSession = Math.max(6, maxTurnsPerSession);
    this.currentSessionId = this.createSession('Workspace Session');
  }

  public createSession(topic = 'General Workspace'): string {
    const id = `sess-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    this.sessions.set(id, {
      id,
      topic: topic.trim() || 'General Workspace',
      activeSubjects: [],
      turns: [],
      rollingSummary: '',
      createdAt: now,
      updatedAt: now
    });
    this.currentSessionId = id;
    return id;
  }

  public switchSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.currentSessionId = sessionId;
    return true;
  }

  public getCurrentSessionId(): string {
    return this.currentSessionId;
  }

  public listSessions(): ConversationSessionSummary[] {
    return Array.from(this.sessions.values())
      .map((s) => this.buildSessionSummary(s))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getTurns(sessionId = this.currentSessionId): ConversationTurn[] {
    const session = this.sessions.get(sessionId);
    return session ? [...session.turns] : [];
  }

  public getRecentTurns(limit = 10, sessionId = this.currentSessionId): ConversationTurn[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.turns.slice(-Math.max(1, limit));
  }

  public addTurn(params: {
    role: ConversationTurn['role'];
    text: string;
    intent?: IntentCategory;
    resolvedSubject?: string;
    toolNames?: string[];
    source?: ConversationTurn['source'];
    timestamp?: number;
    sessionId?: string;
  }): ConversationTurn {
    const targetSessionId = params.sessionId || this.currentSessionId;
    let session = this.sessions.get(targetSessionId);
    if (!session) {
      session = {
        id: targetSessionId,
        topic: 'Workspace Session',
        activeSubjects: [],
        turns: [],
        rollingSummary: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.sessions.set(targetSessionId, session);
    }

    const inferred = params.resolvedSubject || extractSubjectPhrase(params.text) || undefined;
    if (inferred) {
      const normalized = inferred.trim();
      if (normalized && !session.activeSubjects.includes(normalized)) {
        session.activeSubjects.push(normalized);
        if (session.activeSubjects.length > 8) {
          session.activeSubjects = session.activeSubjects.slice(-8);
        }
      }
      if (session.turns.length <= 2 && session.topic === 'Workspace Session') {
        session.topic = normalized;
      }
    }

    const turn: ConversationTurn = {
      id: `turn-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      sessionId: targetSessionId,
      role: params.role,
      text: params.text.trim(),
      timestamp: params.timestamp ?? Date.now(),
      resolvedSubject: inferred,
      intent: params.intent,
      toolNames: params.toolNames,
      source: params.source
    };

    session.turns.push(turn);
    session.updatedAt = turn.timestamp;
    this.compactSessionIfNeeded(session);
    return turn;
  }

  private compactSessionIfNeeded(session: SessionBucket) {
    while (session.turns.length > this.maxTurnsPerSession) {
      const evicted = session.turns.shift();
      if (evicted && evicted.role !== 'system') {
        const snippet = `${evicted.role === 'user' ? 'User' : 'JARVIS'}: ${evicted.text.slice(0, 120)}`;
        session.rollingSummary = session.rollingSummary
          ? `${session.rollingSummary} | ${snippet}`.slice(-900)
          : snippet;
      }
    }
  }

  public resolveFollowUp(
    input: string,
    workspace?: WorkspaceContextSnapshot | null,
    sessionId = this.currentSessionId
  ): FollowUpResolution {
    const trimmed = input.trim();
    const session = this.sessions.get(sessionId);
    const turns = session ? session.turns : [];
    const recentUserTurns = turns.filter((t) => t.role === 'user').slice(-4);
    const recentAssistantTurns = turns.filter((t) => t.role === 'assistant').slice(-2);

    const lastUserWithSubject = [...recentUserTurns].reverse().find((t) => t.resolvedSubject || extractSubjectPhrase(t.text));
    const latestSubject =
      lastUserWithSubject?.resolvedSubject ||
      (lastUserWithSubject ? extractSubjectPhrase(lastUserWithSubject.text) : null) ||
      session?.activeSubjects[session.activeSubjects.length - 1] ||
      undefined;

    const lower = trimmed.toLowerCase();
    const resolvedReferences: string[] = [];
    const followUpCandidate = isShortFragmentOrFollowUp(trimmed);

    // Check explicit model / workspace references
    const importedObj = workspace?.objectsSummary.find((o) => o.modelId === 'reconstructed_object');
    const selectedName = workspace?.selectedObjectName;

    if (
      /\b(imported model|uploaded model|reconstructed model|this model|the model|the object|that object|the mesh)\b/i.test(
        lower
      )
    ) {
      const targetModel = importedObj?.name || selectedName;
      if (targetModel) {
        resolvedReferences.push(`model -> "${targetModel}"`);
      }
    }

    // Resolve follow-up context across prior messages (e.g., "The voice system." after "I am building a JARVIS assistant.")
    if (followUpCandidate && turns.length > 0) {
      if (latestSubject && !lower.includes(latestSubject.toLowerCase())) {
        resolvedReferences.push(`topic -> "${latestSubject}"`);
      }
      const lastAssistant = recentAssistantTurns[recentAssistantTurns.length - 1];
      if (lastAssistant && lastAssistant.text.includes('?')) {
        resolvedReferences.push(`replying to question: "${lastAssistant.text.slice(0, 90)}"`);
      }
    }

    let expandedQuery = trimmed;
    if (resolvedReferences.length > 0) {
      const contextNotes = resolvedReferences.join('; ');
      expandedQuery = `${trimmed} [Session Context: ${contextNotes}]`;
    }

    const inferredSubject =
      extractSubjectPhrase(trimmed) ||
      (followUpCandidate && latestSubject ? `${latestSubject} -> ${trimmed}` : latestSubject);

    return {
      originalInput: trimmed,
      expandedQuery,
      isFollowUp: followUpCandidate && (turns.length > 0 || resolvedReferences.length > 0),
      resolvedReferences,
      inferredSubject: inferredSubject || undefined
    };
  }

  public summarizeSession(sessionId = this.currentSessionId): ConversationSessionSummary | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.buildSessionSummary(session);
  }

  private buildSessionSummary(session: SessionBucket): ConversationSessionSummary {
    const userTurns = session.turns.filter((t) => t.role === 'user');
    const toolSet = new Set<string>();
    session.turns.forEach((t) => t.toolNames?.forEach((name) => toolSet.add(name)));

    const lastUser = userTurns[userTurns.length - 1]?.text || 'No user requests yet';
    const subjectsPart =
      session.activeSubjects.length > 0 ? `Topics: ${session.activeSubjects.join(', ')}. ` : '';
    const toolsPart =
      toolSet.size > 0 ? `Tools used: ${Array.from(toolSet).join(', ')}. ` : '';
    const prefix = session.rollingSummary ? `Earlier: ${session.rollingSummary.slice(0, 180)}... ` : '';

    return {
      sessionId: session.id,
      topic: session.topic,
      activeSubjects: [...session.activeSubjects],
      turnCount: session.turns.length,
      summaryText: `${prefix}${subjectsPart}${toolsPart}Latest request: "${lastUser.slice(0, 120)}".`.trim(),
      updatedAt: session.updatedAt
    };
  }

  public buildModelMessages(
    systemPrompt: string,
    maxTurns = 12,
    sessionId = this.currentSessionId
  ): { role: 'system' | 'user' | 'assistant'; content: string }[] {
    const session = this.sessions.get(sessionId);
    const out: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    if (!session) return out;

    if (session.rollingSummary) {
      out.push({
        role: 'system',
        content: `Condensed earlier session summary (same session only): ${session.rollingSummary}`
      });
    }

    const slice = session.turns
      .filter((t) => t.role === 'user' || t.role === 'assistant')
      .slice(-Math.max(1, maxTurns));

    let totalChars = out.reduce((acc, m) => acc + m.content.length, 0);
    const bounded: { role: 'user' | 'assistant'; content: string }[] = [];

    for (let i = slice.length - 1; i >= 0; i--) {
      const t = slice[i];
      if (totalChars + t.text.length > MAX_HISTORY_CHARS) break;
      bounded.unshift({ role: t.role as 'user' | 'assistant', content: t.text });
      totalChars += t.text.length;
    }

    return [...out, ...bounded];
  }

  public clearCurrentSession() {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return;
    session.turns = [];
    session.activeSubjects = [];
    session.rollingSummary = '';
    session.updatedAt = Date.now();
  }

  public resetAllSessions() {
    this.sessions.clear();
    this.currentSessionId = this.createSession('Workspace Session');
  }
}

export const conversationManager = new ConversationManager();
