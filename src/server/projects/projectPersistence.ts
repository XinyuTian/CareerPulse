import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectSnapshot } from "@/server/intake/contracts";

const STORE_VERSION = 1;
const filePath = () => path.join(process.cwd(), ".data", "project-store.json");

interface StoreFile {
  version: number;
  projects: ProjectSnapshot[];
}

let persistChain: Promise<void> = Promise.resolve();

export async function readProjectsFromDisk(): Promise<ProjectSnapshot[] | null> {
  try {
    const raw = await readFile(filePath(), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || !Array.isArray(parsed.projects) || parsed.projects.length === 0) {
      return null;
    }
    return parsed.projects;
  } catch {
    return null;
  }
}

/** Serializes the latest snapshot; writes are serialized to avoid interleaved corrupt files. */
export function queuePersistProjects(rows: ProjectSnapshot[]): void {
  const snapshot = JSON.parse(JSON.stringify(rows)) as ProjectSnapshot[];
  const body: StoreFile = { version: STORE_VERSION, projects: snapshot };

  persistChain = persistChain
    .then(async () => {
      const target = filePath();
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
      await rename(tmp, target);
    })
    .catch((err) => {
      console.error("[projectPersistence] failed to write store", err);
    });
}
