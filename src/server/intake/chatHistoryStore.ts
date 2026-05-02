import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IntakeMessage, IntakeTurnResult } from "@/server/intake/contracts";

const UNKNOWN_ID = "proj-unknown";
const STORE_VERSION = 1;
/** Messages older than this are dropped on read/write. */
export const PROJECT_CHAT_RETENTION_DAYS = 30;

const filePath = () => path.join(process.cwd(), ".data", "project-chat-history.json");

interface StoreFile {
  version: number;
  byProject: Record<string, IntakeMessage[]>;
}

let persistChain: Promise<void> = Promise.resolve();

function retentionCutoffIso(): string {
  return new Date(Date.now() - PROJECT_CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function pruneMessages(messages: IntakeMessage[]): IntakeMessage[] {
  const cutoff = retentionCutoffIso();
  return messages.filter((m) => typeof m.createdAt === "string" && m.createdAt >= cutoff);
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(filePath(), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || typeof parsed !== "object" || typeof parsed.byProject !== "object") {
      return { version: STORE_VERSION, byProject: {} };
    }
    return { version: STORE_VERSION, byProject: { ...parsed.byProject } };
  } catch {
    return { version: STORE_VERSION, byProject: {} };
  }
}

async function writeStorePruned(store: StoreFile): Promise<void> {
  const pruned: StoreFile = { version: STORE_VERSION, byProject: {} };
  for (const [pid, msgs] of Object.entries(store.byProject)) {
    const next = pruneMessages(Array.isArray(msgs) ? msgs : []);
    if (next.length) pruned.byProject[pid] = next;
  }
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(pruned, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

function isValidMessage(m: unknown): m is IntakeMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    (o.role === "user" || o.role === "assistant") &&
    typeof o.content === "string" &&
    typeof o.createdAt === "string"
  );
}

/** Persist a user+assistant (or any) turn for a real project; skips the unknown bucket. */
export async function appendProjectChatTurn(projectId: string, messages: IntakeMessage[]): Promise<void> {
  if (!projectId || projectId === UNKNOWN_ID || messages.length === 0) return;

  const task = persistChain.then(async () => {
    const store = await readStore();
    const existing = (store.byProject[projectId] ?? []).filter(isValidMessage);
    const incoming = messages.filter(isValidMessage);
    const combined = [...existing, ...incoming];
    combined.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    store.byProject[projectId] = combined;
    await writeStorePruned(store);
  });
  persistChain = task.catch((err) => {
    console.error("[chatHistoryStore] append failed", err);
  });
  await task;
}

export async function loadProjectChatHistory(projectId: string): Promise<IntakeMessage[]> {
  if (!projectId || projectId === UNKNOWN_ID) return [];
  await persistChain.catch(() => undefined);
  const store = await readStore();
  const raw = (store.byProject[projectId] ?? []).filter(isValidMessage);
  return pruneMessages(raw).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Fold source project threads into the survivor row (project merge). */
export async function mergeProjectChatHistoryInto(targetId: string, sourceIds: string[]): Promise<void> {
  const sources = sourceIds.filter((id) => id && id !== UNKNOWN_ID && id !== targetId);
  if (!targetId || targetId === UNKNOWN_ID || sources.length === 0) return;

  const task = persistChain.then(async () => {
    const store = await readStore();
    let combined = [...(store.byProject[targetId] ?? [])].filter(isValidMessage);
    for (const sid of sources) {
      combined.push(...(store.byProject[sid] ?? []).filter(isValidMessage));
      delete store.byProject[sid];
    }
    combined.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    store.byProject[targetId] = combined;
    await writeStorePruned(store);
  });
  persistChain = task.catch((err) => {
    console.error("[chatHistoryStore] merge failed", err);
  });
  await task;
}

/** After a split, keep prior thread on the first new project id. */
export async function moveProjectChatOnSplit(oldProjectId: string, firstNewProjectId: string): Promise<void> {
  if (
    !oldProjectId ||
    !firstNewProjectId ||
    oldProjectId === UNKNOWN_ID ||
    firstNewProjectId === UNKNOWN_ID ||
    oldProjectId === firstNewProjectId
  ) {
    return;
  }

  const task = persistChain.then(async () => {
    const store = await readStore();
    const prior = (store.byProject[oldProjectId] ?? []).filter(isValidMessage);
    delete store.byProject[oldProjectId];
    if (prior.length) {
      const existing = (store.byProject[firstNewProjectId] ?? []).filter(isValidMessage);
      const combined = [...existing, ...prior].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      store.byProject[firstNewProjectId] = combined;
    }
    await writeStorePruned(store);
  });
  persistChain = task.catch((err) => {
    console.error("[chatHistoryStore] split move failed", err);
  });
  await task;
}

/** Where to file this turn: explicit project, else first merge/create target from ingest. */
export function resolveProjectIdForChatHistory(
  requestProjectId: string | undefined,
  events: IntakeTurnResult["projectStoreEvents"],
): string | null {
  const pid = requestProjectId?.trim();
  if (pid && pid !== UNKNOWN_ID) return pid;
  if (events?.mergedIds?.length) return events.mergedIds[0];
  if (events?.createdIds?.length === 1) return events.createdIds[0];
  return null;
}
