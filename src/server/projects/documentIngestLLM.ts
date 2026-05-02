import { AiBuilderApiClient } from "@/server/api/client";
import { z } from "zod";

const OperationSchema = z.object({
  action: z.enum(["merge_existing", "create_new", "split_new"]),
  /** When action is merge_existing, prefer this project id from the provided catalog. */
  targetProjectId: z.string().nullable().optional(),
  /**
   * For split_new: the broader row (e.g. company-wide bucket) this message should be carved out of.
   * Usually the same as the user's current project when they describe one distinct initiative.
   */
  sourceProjectId: z.string().nullable().optional(),
  /** When merge_existing: after merging details, fold this other catalog project into the target row. */
  absorbProjectId: z.string().nullable().optional(),
  /** Display name for the work (for create, or to match existing). */
  name: z.string(),
  company: z.string(),
  /** Bullet-style facts, resume bullets, or pasted chat transcript to merge into the project. */
  details: z.string(),
  /** If scope/title evolved, set a new project name for an existing merge. */
  renameProjectTo: z.string().nullable().optional(),
  updatedCompany: z.string().nullable().optional(),
  updatedFocusArea: z.string().nullable().optional(),
});

const PlanSchema = z.object({
  operations: z.array(OperationSchema).min(1),
});

export type DocumentIngestOperation = z.infer<typeof OperationSchema>;

const client = new AiBuilderApiClient();

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return JSON.parse(fence[1].trim());
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Model did not return JSON.");
}

export async function planDocumentIngest(
  documentText: string,
  existingProjects: Array<{ id: string; name: string; company: string; focus?: string }>,
): Promise<DocumentIngestOperation[] | null> {
  const catalog = JSON.stringify(existingProjects, null, 2);
  const doc = documentText.slice(0, 14_000);

  const userPrompt = `You ingest resumes, exported chat logs, or notes into a structured career database.

Existing projects (JSON array). Use exact "id" for merge_existing when you are confident it is the same initiative:
${catalog}

Document text:
---
${doc}
---

Return ONLY valid JSON (no markdown) with this shape:
{
  "operations": [
    {
      "action": "merge_existing" | "create_new" | "split_new",
      "targetProjectId": string | null,
      "sourceProjectId": string | null,
      "absorbProjectId": string | null,
      "name": string,
      "company": string,
      "details": string,
      "renameProjectTo": string | null,
      "updatedCompany": string | null,
      "updatedFocusArea": string | null
    }
  ]
}

Rules:
- If content clearly extends an existing project, use merge_existing with that project's id.
- If it is a distinct initiative at a new employer or unrelated to any row, use create_new (targetProjectId null).
- Use split_new when the text clearly describes one specific initiative that should be its own project while still tied to a broader existing row (e.g. one employer bucket covering many launches): set sourceProjectId to that broader project's id, and name/company/details for the new initiative.
- If two existing catalog projects are the same work, merge_existing into the canonical row and set absorbProjectId to the duplicate's id to combine rows.
- If scope or branding changed for an existing project, set renameProjectTo and/or updatedCompany and/or updatedFocusArea.
- Put complementary facts only in "details"; do not repeat the entire resume if unnecessary.
- Prefer fewer, larger operations over many tiny fragments when the document is coherent.
- At most 4 operations.
`;

  try {
    const result = await client.chatCompletion({
      model: "supermind-agent-v1",
      temperature: 0.2,
      stream: false,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "You output only compact JSON for downstream parsing. Never add commentary outside JSON.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return null;
    }

    const parsed = extractJsonObject(content);
    const plan = PlanSchema.safeParse(parsed);
    if (!plan.success) {
      return null;
    }
    return plan.data.operations;
  } catch {
    return null;
  }
}

export async function planIntakeProjectOps(input: {
  message: string;
  currentProjectId?: string;
  currentProjectSummary: string;
  existingProjects: Array<{ id: string; name: string; company: string; focus?: string }>;
  /** True when the UI "new log" bucket is selected — strongly prefer merging into a matching catalog row. */
  treatCurrentAsNewEntry?: boolean;
}): Promise<DocumentIngestOperation[] | null> {
  const catalog = JSON.stringify(input.existingProjects, null, 2);
  const msg = input.message.slice(0, 8000);

  const newEntryRules = input.treatCurrentAsNewEntry
    ? `
Extra rules for this turn (NEW ENTRY / no specific project selected):
- The user is not pinned to one historical row. Compare the message to EVERY catalog id for employer, product, team, client, role title, and initiative names.
- If the message clearly continues or describes work that fits an existing project, you MUST use merge_existing with that catalog targetProjectId. Put only the new facts in details.
- Use create_new only when the initiative is genuinely absent from the catalog (new employer or unrelated thread). Do not create a near-duplicate if a strong catalog match exists.
`
    : "";

  const userPrompt = `You maintain a structured project list for a career log. Output only JSON.

Catalog (use exact "id" values):
${catalog}

The user is currently focused on this row (may be broad, e.g. one project per company):
${input.currentProjectSummary || `(none; currentProjectId=${input.currentProjectId ?? "unset"})`}
${newEntryRules}
Their latest message:
---
${msg}
---

Return ONLY valid JSON:
{
  "operations": [
    {
      "action": "merge_existing" | "create_new" | "split_new",
      "targetProjectId": string | null,
      "sourceProjectId": string | null,
      "absorbProjectId": string | null,
      "name": string,
      "company": string,
      "details": string,
      "renameProjectTo": string | null,
      "updatedCompany": string | null,
      "updatedFocusArea": string | null
    }
  ]
}

Rules (reason in English; all JSON strings in English):
- merge_existing: the message adds detail to an existing initiative. Set targetProjectId. Put only new facts in details.
- create_new: a distinct initiative that does not belong in any catalog row (new employer or unrelated thread). sourceProjectId null.
- split_new: the message is mainly about ONE specific initiative (product, program, engagement) that should be tracked separately from a broader bucket row (e.g. company-wide). Set sourceProjectId to that broader row's id (often the current row), name = initiative name, company = employer or same as parent, details = what they said (concise bullets ok).
- absorbProjectId: only with merge_existing when the user indicates two catalog entries are duplicates; targetProjectId = survivor, absorbProjectId = duplicate row id to combine into one.
- If the message only lightly updates the current initiative without splitting, a single merge_existing into the best-matching id is enough.
- At most 3 operations.
`;

  try {
    const result = await client.chatCompletion({
      model: "supermind-agent-v1",
      temperature: 0.15,
      stream: false,
      max_tokens: 2500,
      messages: [
        {
          role: "system",
          content:
            "You output only compact JSON for downstream parsing. Never add commentary outside JSON. All string values in English.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return null;
    }

    const parsed = extractJsonObject(content);
    const plan = PlanSchema.safeParse(parsed);
    if (!plan.success) {
      return null;
    }
    return plan.data.operations;
  } catch {
    return null;
  }
}
