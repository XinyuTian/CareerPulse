import { AiBuilderApiClient } from "@/server/api/client";

const SYSTEM_PROMPT = `You are a career copilot.
You ask focused clarification questions for project-based career tracking.
You return concise responses and avoid generic advice unless asked.
Always write in English, including when the user's message is short or was produced by speech-to-text.
Prioritize extracting: project context, scope, contributions, outcomes, metrics, and timeline updates.`;

const client = new AiBuilderApiClient();

export async function generateAssistantReply(
  userMessage: string,
  contextSummary: string,
): Promise<string> {
  const payload = {
    model: "supermind-agent-v1",
    temperature: 0.7,
    stream: false,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "system" as const, content: `Context:\n${contextSummary}` },
      { role: "user" as const, content: userMessage },
    ],
  };

  try {
    const result = await client.chatCompletion(payload);
    const content = result.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
  } catch {
    // Fall through to deterministic fallback response.
  }

  return "Thanks. To keep this project record strong, could you share one concrete outcome or metric from that work?";
}
