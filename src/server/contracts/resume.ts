export interface ResumeTailorRequest {
  targetRole: string;
  company?: string;
  jobDescription: string;
  projectIds: string[];
}

export interface ResumeBullet {
  projectId: string;
  bullet: string;
  evidenceLink?: string;
}

export interface ResumeTailorResponse {
  summary: string;
  bullets: ResumeBullet[];
  missingInputs: string[];
}
