import type { IntakeTurnInput, IntakeTurnResult } from "@/server/intake/contracts";
import { processCareerTurn } from "@/server/llm/extractCareerData";

export async function runIntakeTurn(input: IntakeTurnInput): Promise<IntakeTurnResult> {
  if (!input.message.trim()) {
    throw new Error("Message cannot be empty.");
  }

  return processCareerTurn(input);
}
