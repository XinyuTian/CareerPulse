import { computeSectionHealth, extractStructuredFacts } from "@/server/intake/completeness";
import type { ProjectSnapshot, StructuredFact } from "@/server/intake/contracts";
import type { DocumentIngestOperation } from "@/server/projects/documentIngestLLM";
import type { IngestChunk } from "@/server/projects/parseIngestDocument";
import {
  mergeProjectChatHistoryInto,
  moveProjectChatOnSplit,
} from "@/server/intake/chatHistoryStore";
import { queuePersistProjects, readProjectsFromDisk } from "@/server/projects/projectPersistence";

const UNKNOWN_ID = "proj-unknown";

const nowIso = () => new Date().toISOString();

function cloneProject(p: ProjectSnapshot): ProjectSnapshot {
  return {
    ...p,
    labels: [...p.labels],
    knownFacts: p.knownFacts.map((f) => ({ ...f })),
    sectionHealth: p.sectionHealth.map((s) => ({ ...s })),
  };
}

function mergeFacts(existing: StructuredFact[], incoming: StructuredFact[]): StructuredFact[] {
  const seen = new Set(existing.map((f) => `${f.factType}:${f.value}`));
  const next = [...existing];
  for (const f of incoming) {
    const key = `${f.factType}:${f.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      next.push({ ...f });
    }
  }
  return next;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreMatch(project: ProjectSnapshot, chunk: IngestChunk): number {
  const nt = normalize(chunk.title);
  const nb = normalize(chunk.body).slice(0, 400);
  const pn = normalize(project.name);
  const pc = normalize(project.company);
  let score = 0;
  if (pn && (nt.includes(pn) || pn.includes(nt))) score += 3;
  if (pc !== "unassigned" && nb.includes(pc)) score += 2;
  if (pc !== "unassigned" && nt.includes(pc)) score += 1;
  return score;
}

function pickMergeTarget(
  projectRows: ProjectSnapshot[],
  chunk: IngestChunk,
  forceProjectId?: string,
): ProjectSnapshot | null {
  if (forceProjectId) {
    return projectRows.find((p) => p.id === forceProjectId) ?? null;
  }
  let best: ProjectSnapshot | null = null;
  let bestScore = 0;
  for (const p of projectRows) {
    if (p.id === UNKNOWN_ID) continue;
    const s = scoreMatch(p, chunk);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return bestScore >= 2 ? best : null;
}

const initial: ProjectSnapshot[] = [
  {
    id: UNKNOWN_ID,
    name: "Unknown Project",
    company: "Unassigned",
    status: "UNKNOWN",
    updatedAt: nowIso(),
    sectionHealth: computeSectionHealth(""),
    knownFacts: [],
    labels: ["bucket-unknown"],
  },
];

let projects: ProjectSnapshot[] = initial.map((p) => cloneProject(p));

let hydrated = false;
let hydrating: Promise<void> | null = null;

function isValidSnapshot(p: unknown): p is ProjectSnapshot {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.company === "string" &&
    typeof o.updatedAt === "string" &&
    (o.status === "ACTIVE" ||
      o.status === "PAUSED" ||
      o.status === "COMPLETED" ||
      o.status === "UNKNOWN") &&
    Array.isArray(o.knownFacts) &&
    Array.isArray(o.sectionHealth) &&
    Array.isArray(o.labels)
  );
}

function normalizeLoadedData(raw: ProjectSnapshot[]): ProjectSnapshot[] {
  const map = new Map<string, ProjectSnapshot>();
  for (const row of raw) {
    if (!isValidSnapshot(row)) continue;
    map.set(row.id, cloneProject(row));
  }
  if (!map.has(UNKNOWN_ID)) {
    map.set(UNKNOWN_ID, cloneProject(initial[0]));
  }
  return [...map.values()];
}

function persist(): void {
  queuePersistProjects(projects);
}

/** Call from API handlers before reading or mutating projects (in-memory store loads from disk once). */
export async function ensureProjectStoreHydrated(): Promise<void> {
  if (hydrated) return;
  if (!hydrating) {
    hydrating = (async () => {
      try {
        const fromDisk = await readProjectsFromDisk();
        if (fromDisk?.length) {
          projects = normalizeLoadedData(fromDisk);
        } else {
          projects = initial.map(cloneProject);
        }
      } catch {
        projects = initial.map(cloneProject);
      } finally {
        hydrated = true;
      }
    })();
  }
  await hydrating;
}

export function listProjects(): ProjectSnapshot[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(cloneProject);
}

/** Catalog for LLM ingest (excludes the unknown bucket). */
export function getProjectsCatalogForIngest(): Array<{
  id: string;
  name: string;
  company: string;
  focus?: string;
}> {
  return projects
    .filter((p) => p.id !== UNKNOWN_ID)
    .map((p) => ({
      id: p.id,
      name: p.name,
      company: p.company,
      focus: p.currentFocusArea,
    }));
}

export function ingestLlmOperations(operations: DocumentIngestOperation[]): {
  mergedIds: string[];
  createdIds: string[];
  summaries: string[];
} {
  const mergedIds: string[] = [];
  const createdIds: string[] = [];
  const summaries: string[] = [];

  for (const op of operations) {
    if (op.action === "create_new") {
      const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
      const facts = extractStructuredFacts(op.details);
      const health = computeSectionHealth(op.details);
      projects.push({
        id,
        name: op.name.slice(0, 200),
        company: op.company.slice(0, 120),
        status: "ACTIVE",
        updatedAt: nowIso(),
        sectionHealth: health,
        knownFacts: facts,
        labels: ["from-document", "llm-ingest", "review-merge"],
        currentFocusArea: op.updatedFocusArea?.trim() || op.details.slice(0, 500),
      });
      createdIds.push(id);
      summaries.push(`Created project "${op.name}" (${op.company}).`);
      continue;
    }

    if (op.action === "split_new") {
      const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
      const facts = extractStructuredFacts(op.details);
      const health = computeSectionHealth(op.details);
      projects.push({
        id,
        name: op.name.slice(0, 200),
        company: op.company.slice(0, 120),
        status: "ACTIVE",
        updatedAt: nowIso(),
        sectionHealth: health,
        knownFacts: facts,
        labels: ["from-intake", "llm-ingest", "split", "review-merge"],
        currentFocusArea: op.updatedFocusArea?.trim() || op.details.slice(0, 500),
      });
      createdIds.push(id);
      const srcId = op.sourceProjectId?.trim();
      if (srcId && srcId !== UNKNOWN_ID) {
        const si = findIndex(srcId);
        if (si !== -1) {
          const parent = projects[si];
          const spinoff: StructuredFact = {
            factType: "spinoff",
            value: `Tracked a distinct initiative separately: "${op.name}" (project ${id}).`,
            confidence: "INFERRED",
          };
          projects[si] = {
            ...parent,
            knownFacts: mergeFacts(parent.knownFacts, [spinoff]),
            updatedAt: nowIso(),
            labels: mergeUniqueLabels(parent.labels, ["has-spinoff", "from-intake"]),
          };
          mergedIds.push(parent.id);
        }
      }
      summaries.push(`Split: new project "${op.name}" (${op.company}) for a distinct initiative.`);
      continue;
    }

    if (op.action !== "merge_existing") {
      continue;
    }

    const byId =
      op.targetProjectId && op.targetProjectId !== UNKNOWN_ID
        ? projects.find((p) => p.id === op.targetProjectId)
        : null;
    const chunk: IngestChunk = {
      title: op.name,
      company: op.company,
      body: op.details,
    };
    const fuzzy = byId ?? pickMergeTarget(projects, chunk, undefined);
    const target = fuzzy && fuzzy.id !== UNKNOWN_ID ? fuzzy : null;

    if (!target) {
      const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
      const facts = extractStructuredFacts(op.details);
      const health = computeSectionHealth(op.details);
      projects.push({
        id,
        name: op.name.slice(0, 200),
        company: op.company.slice(0, 120),
        status: "ACTIVE",
        updatedAt: nowIso(),
        sectionHealth: health,
        knownFacts: facts,
        labels: ["from-document", "llm-ingest", "review-merge", "unmatched-merge"],
        currentFocusArea: op.updatedFocusArea?.trim() || op.details.slice(0, 500),
      });
      createdIds.push(id);
      summaries.push(
        `Could not match merge target for "${op.name}"; created a new project (review "unmatched-merge").`,
      );
      continue;
    }

    const i = findIndex(target.id);
    if (i === -1) continue;
    const cur = projects[i];
    const combinedBody = [cur.knownFacts.map((f) => f.value).join("\n"), op.details].filter(Boolean).join("\n\n");
    const facts = extractStructuredFacts(op.details);
    const nextFacts = mergeFacts(cur.knownFacts, facts);
    const nextName = (op.renameProjectTo?.trim() || cur.name).slice(0, 200);
    const nextCompany = (op.updatedCompany?.trim() || cur.company).slice(0, 120);
    const nextFocus = op.updatedFocusArea?.trim() || cur.currentFocusArea;

    projects[i] = {
      ...cur,
      name: nextName,
      company: nextCompany,
      currentFocusArea: nextFocus,
      knownFacts: nextFacts,
      sectionHealth: computeSectionHealth(combinedBody.slice(-2000)),
      updatedAt: nowIso(),
      labels: mergeUniqueLabels(cur.labels, ["from-document", "llm-ingest"]),
      status: cur.status === "UNKNOWN" ? "ACTIVE" : cur.status,
    };
    mergedIds.push(cur.id);
    const renamed = op.renameProjectTo?.trim() && op.renameProjectTo.trim() !== cur.name;
    summaries.push(
      renamed
        ? `Merged into "${cur.name}" → renamed to "${nextName}" at ${nextCompany}.`
        : `Merged complementary details into "${nextName}" (${nextCompany}).`,
    );

    const absorbId = op.absorbProjectId?.trim();
    if (absorbId && absorbId !== target.id && absorbId !== UNKNOWN_ID) {
      const folded = mergeProjectsInto(target.id, [absorbId]);
      if (folded.ok) {
        summaries.push(`Merged duplicate project ${absorbId} into "${nextName}".`);
      }
    }
  }

  persist();
  return { mergedIds, createdIds, summaries };
}

function findIndex(id: string) {
  return projects.findIndex((p) => p.id === id);
}

export function ingestChunks(
  chunks: IngestChunk[],
  options?: { forceProjectId?: string },
): { mergedIds: string[]; createdIds: string[] } {
  const mergedIds: string[] = [];
  const createdIds: string[] = [];

  for (const chunk of chunks) {
    const facts = extractStructuredFacts(chunk.body);
    const health = computeSectionHealth(chunk.body);
    const target = pickMergeTarget(projects, chunk, options?.forceProjectId);

    if (target) {
      const i = findIndex(target.id);
      if (i === -1) continue;
      const cur = projects[i];
      const combinedBody = [cur.knownFacts.map((f) => f.value).join("\n"), chunk.body].filter(Boolean).join("\n\n");
      const nextFacts = mergeFacts(cur.knownFacts, facts);
      const nextHealth = computeSectionHealth(combinedBody.slice(-2000));
      projects[i] = {
        ...cur,
        knownFacts: nextFacts,
        sectionHealth: nextHealth,
        updatedAt: nowIso(),
        labels: mergeUniqueLabels(cur.labels, ["from-upload"]),
        status: cur.status === "UNKNOWN" ? "ACTIVE" : cur.status,
      };
      mergedIds.push(cur.id);
    } else {
      const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
      const row: ProjectSnapshot = {
        id,
        name: chunk.title.slice(0, 200),
        company: chunk.company.slice(0, 120),
        status: "ACTIVE",
        updatedAt: nowIso(),
        sectionHealth: health,
        knownFacts: facts,
        labels: ["from-upload", "review-merge"],
        currentFocusArea: chunk.body.slice(0, 500),
      };
      projects.push(row);
      createdIds.push(id);
    }
  }

  persist();
  return { mergedIds, createdIds };
}

function mergeUniqueLabels(a: string[], b: string[]) {
  return [...new Set([...a, ...b])];
}

export function mergeProjectsInto(targetId: string, sourceIds: string[]): { ok: boolean; error?: string } {
  if (targetId === UNKNOWN_ID) {
    return { ok: false, error: "Cannot merge into the unknown bucket." };
  }
  const ti = findIndex(targetId);
  if (ti === -1) return { ok: false, error: "Target project not found." };

  const target = projects[ti];
  const sources = sourceIds.filter((id) => id !== targetId && id !== UNKNOWN_ID);
  const bodies: string[] = [target.knownFacts.map((f) => f.value).join("\n")];

  for (const sid of sources) {
    const si = findIndex(sid);
    if (si === -1) continue;
    const s = projects[si];
    bodies.push(s.knownFacts.map((f) => f.value).join("\n"));
    target.knownFacts = mergeFacts(target.knownFacts, s.knownFacts);
    target.labels = mergeUniqueLabels(target.labels, s.labels);
  }

  const combined = bodies.join("\n\n");
  projects[ti] = {
    ...target,
    sectionHealth: computeSectionHealth(combined.slice(-2000)),
    updatedAt: nowIso(),
    labels: mergeUniqueLabels(target.labels, ["merged"]),
  };

  projects = projects.filter((p) => !sources.includes(p.id));
  persist();
  void mergeProjectChatHistoryInto(targetId, sources).catch((err) =>
    console.error("[projectStore] mergeProjectChatHistoryInto", err),
  );
  return { ok: true };
}

export function splitProject(
  projectId: string,
  segments: Array<{ name: string; company: string }>,
): { ok: boolean; error?: string; newIds?: string[] } {
  if (projectId === UNKNOWN_ID) {
    return { ok: false, error: "Cannot split the unknown bucket." };
  }
  if (segments.length < 2) {
    return { ok: false, error: "Split requires at least two new projects." };
  }
  const pi = findIndex(projectId);
  if (pi === -1) return { ok: false, error: "Project not found." };
  const original = projects[pi];

  const facts = [...original.knownFacts];
  const newIds: string[] = [];
  const newRows: ProjectSnapshot[] = segments.map((seg, idx) => {
    const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
    newIds.push(id);
    const slice = facts.filter((_, i) => i % segments.length === idx);
    const body = slice.map((f) => f.value).join("\n");
    return {
      id,
      name: seg.name.slice(0, 200),
      company: seg.company.slice(0, 120),
      status: "ACTIVE" as const,
      updatedAt: nowIso(),
      sectionHealth: computeSectionHealth(body),
      knownFacts:
        slice.length > 0
          ? slice
          : [{ factType: "note", value: "(split from parent; add details)", confidence: "INFERRED" }],
      labels: mergeUniqueLabels(
        original.labels.filter((l) => l !== "review-merge"),
        ["from-split", "review-merge"],
      ),
      currentFocusArea: original.currentFocusArea,
    };
  });

  projects = projects.filter((p) => p.id !== projectId);
  projects.push(...newRows);
  persist();
  if (newIds[0]) {
    void moveProjectChatOnSplit(projectId, newIds[0]).catch((err) =>
      console.error("[projectStore] moveProjectChatOnSplit", err),
    );
  }
  return { ok: true, newIds };
}

export function setProjectLabels(projectId: string, labels: string[]): { ok: boolean; error?: string } {
  const i = findIndex(projectId);
  if (i === -1) return { ok: false, error: "Project not found." };
  const cur = projects[i];
  projects[i] = {
    ...cur,
    labels: [...new Set(labels.map((l) => l.trim()).filter(Boolean))],
    updatedAt: nowIso(),
  };
  persist();
  return { ok: true };
}

export function updateProjectDisplay(
  projectId: string,
  fields: { name: string; company: string },
): { ok: boolean; error?: string } {
  if (projectId === UNKNOWN_ID) {
    return { ok: false, error: "Cannot rename the unknown bucket." };
  }
  const i = findIndex(projectId);
  if (i === -1) return { ok: false, error: "Project not found." };
  const name = fields.name.trim().slice(0, 200);
  const company = (fields.company.trim().slice(0, 120) || "Unassigned").trim() || "Unassigned";
  if (!name) return { ok: false, error: "Name is required." };
  const cur = projects[i];
  projects[i] = {
    ...cur,
    name,
    company,
    updatedAt: nowIso(),
  };
  persist();
  return { ok: true };
}
