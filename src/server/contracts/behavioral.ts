export interface BehavioralQuestionPrepRequest {
  question: string;
  preferredProjects?: string[];
}

export interface StarDraft {
  projectId: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  confidence: "CONFIRMED" | "INFERRED" | "NEEDS_REVIEW";
}

export interface BehavioralQuestionPrepResponse {
  suggestedStories: StarDraft[];
  followUpQuestions: string[];
}
