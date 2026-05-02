import { NextResponse } from "next/server";
import { generateCheckInTasks } from "@/server/scheduler/checkins";

export async function GET() {
  const tasks = generateCheckInTasks({
    staleProjects: ["Unknown Project"],
    lastActivityAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
  });

  return NextResponse.json({ tasks });
}
