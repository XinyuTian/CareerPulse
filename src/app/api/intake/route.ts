import { NextResponse } from "next/server";
import { sessions } from "@/server/data/mockStore";
import type { InputChannel, IntakeMode } from "@/server/intake/contracts";
import {
  appendProjectChatTurn,
  resolveProjectIdForChatHistory,
} from "@/server/intake/chatHistoryStore";
import { runIntakeTurn } from "@/server/intake/orchestrator";

interface IntakeRequestBody {
  sessionId: string;
  mode?: IntakeMode;
  message: string;
  projectId?: string;
  inputChannel?: InputChannel;
}

export async function POST(request: Request) {
  const body = (await request.json()) as IntakeRequestBody;
  if (!body.sessionId || !body.message) {
    return NextResponse.json({ error: "sessionId and message are required." }, { status: 400 });
  }

  const mode: IntakeMode = body.mode ?? "ONGOING_WORK";

  const existing = sessions.get(body.sessionId);
  const userMessage = {
    id: crypto.randomUUID(),
    role: "user" as const,
    content: body.message,
    createdAt: new Date().toISOString(),
    channel: body.inputChannel ?? "text",
  };

  const result = await runIntakeTurn({
    mode,
    projectId: body.projectId,
    message: body.message,
    inputChannel: body.inputChannel ?? "text",
  });

  sessions.set(body.sessionId, {
    mode,
    projectId: body.projectId,
    messages: [...(existing?.messages ?? []), userMessage, result.assistantMessage],
    latestResult: result,
  });

  const historyProjectId = resolveProjectIdForChatHistory(body.projectId, result.projectStoreEvents);
  if (historyProjectId) {
    await appendProjectChatTurn(historyProjectId, [userMessage, result.assistantMessage]);
  }

  return NextResponse.json({
    sessionId: body.sessionId,
    userMessage,
    assistantMessage: result.assistantMessage,
    followUps: result.followUps,
    sectionHealth: result.sectionHealth,
    extractedFacts: result.extractedFacts,
    needsProjectAssignment: result.needsProjectAssignment,
    projectStoreEvents: result.projectStoreEvents,
  });
}
