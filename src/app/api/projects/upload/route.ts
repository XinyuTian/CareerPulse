import { NextResponse } from "next/server";
import { planDocumentIngest } from "@/server/projects/documentIngestLLM";
import { extractDocumentText } from "@/server/projects/extractDocumentText";
import { parseIngestDocument } from "@/server/projects/parseIngestDocument";
import {
  ensureProjectStoreHydrated,
  getProjectsCatalogForIngest,
  ingestChunks,
  ingestLlmOperations,
} from "@/server/projects/projectStore";

export async function POST(request: Request) {
  await ensureProjectStoreHydrated();
  const form = await request.formData();
  const file = form.get("file");
  const forceProjectId = (form.get("targetProjectId") as string | null)?.trim() || undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }

  let text: string;
  try {
    const extracted = await extractDocumentText(file);
    text = extracted.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read file.";
    return NextResponse.json({ error: message }, { status: 415 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "No readable content in file." }, { status: 400 });
  }

  if (forceProjectId) {
    const chunks = parseIngestDocument(text);
    if (!chunks.length) {
      return NextResponse.json({ error: "No ingestable sections in file." }, { status: 400 });
    }
    const { mergedIds, createdIds } = ingestChunks(chunks, { forceProjectId });
    return NextResponse.json({
      ok: true,
      strategy: "forced-target",
      mergedProjectIds: mergedIds,
      createdProjectIds: createdIds,
      chunkCount: chunks.length,
      summaries: [`Imported into the selected project (${mergedIds[0] ?? forceProjectId}).`],
    });
  }

  const hasApiKey = Boolean(process.env.AI_BUILDER_API_KEY);
  const catalog = getProjectsCatalogForIngest();

  if (hasApiKey && text.length > 200) {
    const plan = await planDocumentIngest(text, catalog);
    if (plan?.length) {
      const { mergedIds, createdIds, summaries } = ingestLlmOperations(plan);
      return NextResponse.json({
        ok: true,
        strategy: "llm",
        mergedProjectIds: mergedIds,
        createdProjectIds: createdIds,
        summaries,
        operationCount: plan.length,
      });
    }
  }

  const chunks = parseIngestDocument(text);
  if (!chunks.length) {
    return NextResponse.json({ error: "No ingestable sections in file." }, { status: 400 });
  }

  const { mergedIds, createdIds } = ingestChunks(chunks, { forceProjectId });

  return NextResponse.json({
    ok: true,
    strategy: "heuristic",
    mergedProjectIds: mergedIds,
    createdProjectIds: createdIds,
    chunkCount: chunks.length,
    summaries: [
      hasApiKey
        ? "Used section-based parsing (LLM plan unavailable or invalid)."
        : "Used section-based parsing (set AI_BUILDER_API_KEY for smarter merge/create/rename).",
    ],
  });
}
