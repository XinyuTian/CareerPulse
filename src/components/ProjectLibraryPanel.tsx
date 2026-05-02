"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

/** Internal bucket for unmatched facts; hidden from UI (use “New log entry” instead). */
const HIDDEN_LIST_PROJECT_ID = "proj-unknown";

export interface ProjectListItem {
  id: string;
  name: string;
  company: string;
  updatedAt: string;
  labels: string[];
}

export function ProjectLibraryPanel() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mergeTarget, setMergeTarget] = useState("");
  const [uploadTarget, setUploadTarget] = useState("");
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [splitRows, setSplitRows] = useState([
    { name: "", company: "" },
    { name: "", company: "" },
  ]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/projects", { cache: "no-store" });
    const data = (await res.json()) as { projects?: ProjectListItem[] };
    setProjects((data.projects ?? []).filter((p) => p.id !== HIDDEN_LIST_PROJECT_ID));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  async function onUploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    if (uploadTarget) fd.set("targetProjectId", uploadTarget);
    setUploadNote(null);
    const res = await fetch("/api/projects/upload", { method: "POST", body: fd });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      mergedProjectIds?: string[];
      createdProjectIds?: string[];
      chunkCount?: number;
    };
    if (!res.ok) {
      setUploadNote(data.error ?? "Upload failed.");
      return;
    }
    const merged = data.mergedProjectIds?.length ?? 0;
    const created = data.createdProjectIds?.length ?? 0;
    setUploadNote(
      `Imported ${data.chunkCount ?? 0} section(s): merged into ${merged} existing project(s), created ${created} new project(s).`,
    );
    input.value = "";
    setSelected({});
    await load();
  }

  async function saveLabels(projectId: string, labels: string[]) {
    const res = await fetch("/api/projects/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setLabels", projectId, labels }),
    });
    if (res.ok) await load();
  }

  async function runMerge() {
    if (!mergeTarget || selectedIds.length < 2) return;
    const sourceIds = selectedIds.filter((id) => id !== mergeTarget);
    if (!sourceIds.length) return;
    const res = await fetch("/api/projects/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "merge", targetId: mergeTarget, sourceIds }),
    });
    if (res.ok) {
      setSelected({});
      setMergeTarget("");
      await load();
    }
  }

  async function runSplit() {
    if (!splitFor) return;
    const segments = splitRows
      .map((r) => ({ name: r.name.trim(), company: r.company.trim() || "Unassigned" }))
      .filter((r) => r.name.length > 0);
    if (segments.length < 2) return;
    const res = await fetch("/api/projects/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "split", projectId: splitFor, segments }),
    });
    if (res.ok) {
      setSplitFor(null);
      setSplitRows([
        { name: "", company: "" },
        { name: "", company: "" },
      ]);
      await load();
    }
  }

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">Upload notes</h2>
        <p className="mb-3 text-xs text-slate-600">
          Drop a .txt or .md file. Use Markdown <code className="rounded bg-slate-100 px-1">## Project name</code>{" "}
          sections to create several projects in one file. If a section matches an existing title or company, facts
          are merged; otherwise new projects are created. Optional: force merge into one project below.
        </p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={onUploadFile}>
          <label className="text-xs font-medium text-slate-600">
            Merge into (optional)
            <select
              className="mt-1 block w-56 rounded-lg border px-2 py-1.5 text-sm"
              value={uploadTarget}
              onChange={(e) => setUploadTarget(e.target.value)}
            >
              <option value="">Auto match by title / company</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            File
            <input name="file" type="file" accept=".txt,.md,.markdown,text/plain" className="mt-1 block text-sm" />
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
            Upload
          </button>
        </form>
        {uploadNote && <p className="mt-2 text-xs text-slate-700">{uploadNote}</p>}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">Combine or split</h2>
        <p className="mb-3 text-xs text-slate-600">
          Select projects to merge duplicates, or split one project that was over-grouped. Projects tagged{" "}
          <span className="font-medium">review-merge</span> are good candidates to tidy up.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-600">
            Keep (target)
            <select
              className="ml-1 rounded-lg border px-2 py-1.5 text-sm"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
            >
              <option value="">Choose…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-sm"
            disabled={!mergeTarget || selectedIds.length < 2 || !selectedIds.includes(mergeTarget)}
            onClick={() => void runMerge()}
          >
            Merge selected into target
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Projects</h2>
          <Link
            href="/intake?new=1"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            New log entry
          </Link>
        </div>
        <ul className="space-y-4">
          {projects.map((project) => (
            <li key={project.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start gap-3">
                <input
                  type="checkbox"
                  checked={!!selected[project.id]}
                  onChange={() => toggle(project.id)}
                  className="mt-1"
                  aria-label={`Select ${project.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{project.name}</p>
                  <p className="text-xs text-slate-500">{project.company}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {project.labels.map((label) => (
                      <span key={label} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      className="min-w-[8rem] flex-1 rounded border px-2 py-1 text-xs"
                      placeholder="Add label"
                      value={labelDrafts[project.id] ?? ""}
                      onChange={(e) => setLabelDrafts((d) => ({ ...d, [project.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        const next = labelDrafts[project.id]?.trim();
                        if (!next) return;
                        void saveLabels(project.id, [...new Set([...project.labels, next])]);
                        setLabelDrafts((d) => ({ ...d, [project.id]: "" }));
                      }}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs text-rose-700"
                      onClick={() => void saveLabels(project.id, project.labels.filter((l) => l !== "review-merge"))}
                    >
                      Clear “review-merge”
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded border px-2 py-1 text-xs"
                  onClick={() => {
                    setSplitFor(project.id);
                    setSplitRows([
                      { name: `${project.name} (A)`, company: project.company },
                      { name: `${project.name} (B)`, company: project.company },
                    ]);
                  }}
                >
                  Split…
                </button>
              </div>
            </li>
          ))}
          {projects.length === 0 && <li className="text-sm text-slate-500">No projects.</li>}
        </ul>
      </section>

      {splitFor && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-950">Split project</h3>
          <p className="mt-1 text-xs text-amber-900">
            Facts are distributed across new projects in round-robin order. Rename each slice, then confirm.
          </p>
          <div className="mt-3 space-y-2">
            {splitRows.map((row, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input
                  className="flex-1 rounded border px-2 py-1 text-sm"
                  placeholder="New project name"
                  value={row.name}
                  onChange={(e) => {
                    const next = [...splitRows];
                    next[i] = { ...next[i], name: e.target.value };
                    setSplitRows(next);
                  }}
                />
                <input
                  className="w-40 rounded border px-2 py-1 text-sm"
                  placeholder="Company"
                  value={row.company}
                  onChange={(e) => {
                    const next = [...splitRows];
                    next[i] = { ...next[i], company: e.target.value };
                    setSplitRows(next);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => void runSplit()}>
              Confirm split
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm"
              onClick={() => setSplitRows((rows) => [...rows, { name: "", company: "" }])}
            >
              Add row
            </button>
            <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setSplitFor(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
