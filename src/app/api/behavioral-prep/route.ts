import { NextResponse } from "next/server";
import type {
  BehavioralQuestionPrepRequest,
  BehavioralQuestionPrepResponse,
} from "@/server/contracts/behavioral";

export async function POST(request: Request) {
  const body = (await request.json()) as BehavioralQuestionPrepRequest;
  const response: BehavioralQuestionPrepResponse = {
    suggestedStories: [
      {
        projectId: body.preferredProjects?.[0] ?? "proj-unknown",
        situation: "The team needed a faster release process.",
        task: "Own the process redesign.",
        action: "Introduced structured deployment checks and rollout automation.",
        result: "Reduced release friction and improved delivery confidence.",
        confidence: "INFERRED",
      },
    ],
    followUpQuestions: ["What exact metric quantifies the impact?"],
  };

  return NextResponse.json(response);
}
