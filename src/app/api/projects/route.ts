import { NextResponse } from "next/server";
import { ensureProjectStoreHydrated, listProjects } from "@/server/projects/projectStore";

export async function GET() {
  await ensureProjectStoreHydrated();
  return NextResponse.json({
    projects: listProjects(),
  });
}
