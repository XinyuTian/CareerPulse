import { NextResponse } from "next/server";
import {
  ensureProjectStoreHydrated,
  mergeProjectsInto,
  setProjectLabels,
  splitProject,
  updateProjectDisplay,
} from "@/server/projects/projectStore";

type ManageBody =
  | { action: "setLabels"; projectId: string; labels: string[] }
  | { action: "merge"; targetId: string; sourceIds: string[] }
  | { action: "split"; projectId: string; segments: Array<{ name: string; company: string }> }
  | { action: "updateDisplay"; projectId: string; name: string; company: string };

export async function POST(request: Request) {
  await ensureProjectStoreHydrated();
  const body = (await request.json()) as ManageBody;

  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if (body.action === "setLabels") {
    if (!body.projectId || !Array.isArray(body.labels)) {
      return NextResponse.json({ error: "projectId and labels are required." }, { status: 400 });
    }
    const result = setProjectLabels(body.projectId, body.labels);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (body.action === "merge") {
    if (!body.targetId || !Array.isArray(body.sourceIds)) {
      return NextResponse.json({ error: "targetId and sourceIds are required." }, { status: 400 });
    }
    const result = mergeProjectsInto(body.targetId, body.sourceIds);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (body.action === "split") {
    if (!body.projectId || !Array.isArray(body.segments)) {
      return NextResponse.json({ error: "projectId and segments are required." }, { status: 400 });
    }
    const result = splitProject(body.projectId, body.segments);
    return result.ok
      ? NextResponse.json({ ok: true, newIds: result.newIds })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (body.action === "updateDisplay") {
    if (!body.projectId || typeof body.name !== "string" || typeof body.company !== "string") {
      return NextResponse.json({ error: "projectId, name, and company are required." }, { status: 400 });
    }
    const result = updateProjectDisplay(body.projectId, { name: body.name, company: body.company });
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
