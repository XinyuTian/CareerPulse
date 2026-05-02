import { NextResponse } from "next/server";
import { loadProjectChatHistory, PROJECT_CHAT_RETENTION_DAYS } from "@/server/intake/chatHistoryStore";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId query parameter is required." }, { status: 400 });
  }

  const messages = await loadProjectChatHistory(projectId);
  return NextResponse.json({ projectId, messages, retentionDays: PROJECT_CHAT_RETENTION_DAYS });
}
