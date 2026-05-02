export type IntakeMode = "PAST_EXPERIENCE" | "ONGOING_WORK";
export type InputChannel = "text" | "voice";

export type SectionKey =
  | "background"
  | "scope"
  | "contributions"
  | "outcomes"
  | "story";

export type SectionHealthStatus = "MISSING" | "GOOD" | "STALE" | "NEEDS_REVIEW";
export type FactConfidence = "CONFIRMED" | "INFERRED" | "NEEDS_REVIEW";

export interface SectionHealth {
  section: SectionKey;
  status: SectionHealthStatus;
  reason: string;
}

export interface StructuredFact {
  factType: string;
  value: string;
  confidence: FactConfidence;
  sourceAnswerId?: string;
}

export interface ProjectSnapshot {
  id: string;
  name: string;
  company: string;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "UNKNOWN";
  currentFocusArea?: string;
  updatedAt: string;
  sectionHealth: SectionHealth[];
  knownFacts: StructuredFact[];
  /** User-defined tags for filtering and cleanup (e.g. "launch", "from-upload"). */
  labels: string[];
}

export interface IntakeMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  channel?: InputChannel;
}

export interface IntakeTurnInput {
  mode: IntakeMode;
  projectId?: string;
  message: string;
  inputChannel: InputChannel;
  transcript?: string;
}

export interface IntakeProjectStoreEvents {
  mergedIds: string[];
  createdIds: string[];
  summaries: string[];
}

export interface IntakeTurnResult {
  assistantMessage: IntakeMessage;
  followUps: string[];
  sectionHealth: SectionHealth[];
  extractedFacts: StructuredFact[];
  needsProjectAssignment: boolean;
  candidateProjectIds: string[];
  /** Present when AI_BUILDER_API_KEY was set and an LLM project plan was applied this turn. */
  projectStoreEvents?: IntakeProjectStoreEvents;
}
