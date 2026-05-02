import { generateAssistantReply } from "@/server/api/chat";
import {
  buildFollowUpQuestions,
  computeSectionHealth,
  extractStructuredFacts,
} from "@/server/intake/completeness";
import type { IntakeTurnInput, IntakeTurnResult } from "@/server/intake/contracts";
import { tryIntakeQuickCommand } from "@/server/intake/quickCommands";
import { planIntakeProjectOps } from "@/server/projects/documentIngestLLM";
import {
  ensureProjectStoreHydrated,
  getProjectsCatalogForIngest,
  ingestLlmOperations,
  listProjects,
} from "@/server/projects/projectStore";

const UNKNOWN_PROJECT_ID = "proj-unknown";

function projectConfidenceCandidates(message: string): { ids: string[]; needsAssignment: boolean } {
  const unsure = /\b(not sure|unsure|maybe|might|unknown)\b/i.test(message);
  if (unsure) {
    return { ids: [], needsAssignment: true };
  }
  return { ids: [], needsAssignment: false };
}

export async function processCareerTurn(input: IntakeTurnInput): Promise<IntakeTurnResult> {
  await ensureProjectStoreHydrated();
  const allProjects = listProjects();
  const quick = tryIntakeQuickCommand(input.message, {
    projectId: input.projectId,
    projects: allProjects,
  });
  if (quick?.skipLlm) {
    const facts = extractStructuredFacts(input.message);
    const sectionHealth = computeSectionHealth(input.message);
    return {
      assistantMessage: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: quick.reply,
        createdAt: new Date().toISOString(),
      },
      followUps: [],
      sectionHealth,
      extractedFacts: facts,
      needsProjectAssignment: false,
      candidateProjectIds: [],
    };
  }

  const facts = extractStructuredFacts(input.message);
  const sectionHealth = computeSectionHealth(input.message);
  const followUps = buildFollowUpQuestions(sectionHealth);

  let projectStoreEvents: IntakeTurnResult["projectStoreEvents"];
  const minCharsForPlan = 40;
  const treatCurrentAsNewEntry = !input.projectId || input.projectId === UNKNOWN_PROJECT_ID;

  if (process.env.AI_BUILDER_API_KEY && input.message.trim().length >= minCharsForPlan) {
    const catalog = getProjectsCatalogForIngest();
    const current = allProjects.find((p) => p.id === input.projectId);
    const currentProjectSummary = current
      ? `id=${current.id}; name=${current.name}; company=${current.company}; focus=${current.currentFocusArea ?? ""}`
      : "";
    const ops = await planIntakeProjectOps({
      message: input.message,
      currentProjectId: input.projectId,
      currentProjectSummary,
      existingProjects: catalog,
      treatCurrentAsNewEntry,
    });
    if (ops?.length) {
      projectStoreEvents = ingestLlmOperations(ops);
    }
  }

  const contextSummary = [
    `Mode: ${input.mode}`,
    `Current Project ID: ${input.projectId ?? "none"}`,
    `Extracted fact count: ${facts.length}`,
    ...(projectStoreEvents?.summaries?.length
      ? [`Project updates this turn: ${projectStoreEvents.summaries.join(" | ")}`]
      : []),
  ].join("\n");

  const assistantText = await generateAssistantReply(input.message, contextSummary);
  const projectResolution = projectConfidenceCandidates(input.message);

  return {
    assistantMessage: {
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
    },
    followUps,
    sectionHealth,
    extractedFacts: facts,
    needsProjectAssignment: projectResolution.needsAssignment,
    candidateProjectIds: projectResolution.ids,
    projectStoreEvents,
  };
}
