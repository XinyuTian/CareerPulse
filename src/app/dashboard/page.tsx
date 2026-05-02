import Link from "next/link";
import { ProjectLibraryPanel } from "@/components/ProjectLibraryPanel";

async function getProjects() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/projects`, {
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    projects?: Array<{ id: string; name: string; company: string; updatedAt: string; labels?: string[] }>;
  };
  const rows = payload.projects ?? [];
  return rows.filter((p) => p.id !== "proj-unknown");
}

async function getCheckins() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/checkins`, {
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return [];
  const payload = (await response.json()) as { tasks?: Array<{ id: string; title: string; prompt: string; scheduledFor: string }> };
  return payload.tasks ?? [];
}

export default async function DashboardPage() {
  const [projects, tasks] = await Promise.all([getProjects(), getCheckins()]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Career Dashboard</h1>
            <p className="text-sm text-slate-600">Timeline, project health, and upcoming check-ins.</p>
          </div>
          <Link href="/intake?new=1" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            Open Intake Chat
          </Link>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">Projects (recently updated)</h2>
            <ul className="space-y-3">
              {projects.map((project) => (
                <li key={project.id} className="rounded-lg border p-3">
                  <p className="font-medium">{project.name}</p>
                  <p className="text-xs text-slate-500">{project.company}</p>
                  {(project.labels?.length ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-slate-600">{project.labels?.join(", ")}</p>
                  )}
                </li>
              ))}
              {projects.length === 0 && <li className="text-sm text-slate-500">No projects yet.</li>}
            </ul>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">Missing Data Queue</h2>
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Unknown project updates are waiting in <strong>Needs Project Assignment</strong>.
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="rounded-lg border p-2">Background details stale for Unknown Project</li>
              <li className="rounded-lg border p-2">Outcome metrics missing from recent update</li>
            </ul>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold">Library &amp; uploads</h2>
          <p className="mb-4 text-xs text-slate-600">
            Upload supporting notes, attach labels, merge duplicates, or split an over-broad project.
          </p>
          <ProjectLibraryPanel />
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Upcoming Check-ins</h2>
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="rounded-lg border p-3">
                <p className="font-medium">{task.title}</p>
                <p className="text-sm text-slate-700">{task.prompt}</p>
              </li>
            ))}
            {tasks.length === 0 && <li className="text-sm text-slate-500">No tasks scheduled.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
