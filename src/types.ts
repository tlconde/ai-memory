// Shared contracts for every layer. See SPEC.md. Changing a shape here is a spec change.

/** Directory names under the memory root (default `.memory/`). */
export const LAYOUT = {
  log: 'log',
  notes: 'notes',
  wiki: 'wiki',
  past: 'past',
  index: 'INDEX.md',
} as const;

/** Hosts with an adapter. `generic` is the shell fallback. */
export type HostName =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'hermes'
  | 'openclaw'
  | 'generic';

export type LogKind = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'session_start' | 'session_end';

/** One line of `log/<session>.jsonl`. Text is scrubbed of secrets before it is written. */
export interface LogEvent {
  ts: string;          // ISO 8601
  session: string;     // host session id, filename-safe
  host: HostName;
  kind: LogKind;
  tool?: string;       // tool name for tool_call / tool_result
  text: string;        // human-readable content, truncated by the store if oversized
  refs?: string[];     // optional pointers, e.g. file paths
}

/** `<session>:<firstLine>-<lastLine>`, 1-based line numbers in log/<session>.jsonl. */
export type EvidenceRef = string;

export type NoteOrigin = 'session' | 'past';

/** One fact. Stored as `notes/<id>.md` (or `past/<id>.md`) with YAML-like frontmatter and a markdown body. */
export interface Note {
  id: string;            // ULID; also the filename
  about: string;         // entity the fact is about
  body: string;          // the fact, in plain words
  evidence: EvidenceRef[]; // empty => hypothesis
  verified: boolean;
  seen: number;          // sessions that confirmed it
  checked?: string;      // ISO date dream last verified it
  origin: NoteOrigin;
}

export type Layer = 'log' | 'notes' | 'wiki' | 'past';

export interface SearchHit {
  layer: Layer;
  source: string;   // `<session>:<line>` for log, note/wiki id otherwise
  snippet: string;
  score: number;    // lower is better (bm25), after layer weighting
  verified?: boolean;
}

/** The host callback interface every adapter implements, in whatever form its host allows. */
export interface Host {
  onEvent(e: LogEvent): void;           // append to log
  beforeModel(): string;                // INDEX.md text for session start
  afterRun(session: string): void;      // optional dream trigger
  onError(e: unknown): void;
}

/** Budgets enforced by lint and CI. Starting values; the eval tunes them. */
export const BUDGETS = {
  indexTokens: 1500,
  wikiToNotesMaxRatio: 0.5,
  maxEventChars: 8000,
  promoteAfterSessions: 3,
  expirePastAfterSessions: 20,
  pruneUnverifiedAfterSessions: 5,
} as const;
