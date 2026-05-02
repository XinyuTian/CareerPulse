import { NextResponse } from "next/server";
import type { ResumeTailorRequest, ResumeTailorResponse } from "@/server/contracts/resume";

export async function POST(request: Request) {
  const body = (await request.json()) as ResumeTailorRequest;
  const response: ResumeTailorResponse = {
    summary: `Tailored summary draft for ${body.targetRole}.`,
    bullets: body.projectIds.map((projectId) => ({
      projectId,
      bullet: `Drove measurable project outcomes aligned to ${body.targetRole}.`,
    })),
    missingInputs: body.company ? [] : ["target company context"],
  };

  return NextResponse.json(response);
}
