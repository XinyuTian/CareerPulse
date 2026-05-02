import type { IntakeMessage, IntakeMode, IntakeTurnResult } from "@/server/intake/contracts";

export const sessions = new Map<
  string,
  {
    mode: IntakeMode;
    projectId?: string;
    messages: IntakeMessage[];
    latestResult?: IntakeTurnResult;
  }
>();
