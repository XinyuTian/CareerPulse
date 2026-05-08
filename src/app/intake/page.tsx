"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { IntakeMessage, ProjectSnapshot, SectionHealth } from "@/server/intake/contracts";

const INTAKE_MODE = "ONGOING_WORK" as const;
const UNKNOWN_PROJECT_ID = "proj-unknown";

interface IntakeApiResponse {
  userMessage: IntakeMessage;
  assistantMessage: IntakeMessage;
  followUps: string[];
  sectionHealth: SectionHealth[];
  needsProjectAssignment: boolean;
  projectStoreEvents?: { mergedIds: string[]; createdIds: string[]; summaries: string[] };
}

type ProjectRow = ProjectSnapshot;

interface UploadResponse {
  ok?: boolean;
  strategy?: string;
  mergedProjectIds?: string[];
  createdProjectIds?: string[];
  summaries?: string[];
  chunkCount?: number;
  operationCount?: number;
  error?: string;
}

type UiMessage = Pick<IntakeMessage, "role" | "content"> &
  Partial<Pick<IntakeMessage, "createdAt" | "channel">> & { id?: string };

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
      />
    </svg>
  );
}

function StopRecordingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function IntakePage() {
  const searchParams = useSearchParams();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [projectId, setProjectId] = useState<string>(UNKNOWN_PROJECT_ID);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      role: "assistant",
      content:
        "Log something you worked on — past or ongoing. You can type or use the mic. If it matches an existing project, we will attach it there automatically.",
    },
  ]);
  const [input, setInput] = useState("");
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [health, setHealth] = useState<SectionHealth[]>([]);
  const [status, setStatus] = useState("Ready");
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string>("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [titleEditOpen, setTitleEditOpen] = useState(false);
  const [editTitleName, setEditTitleName] = useState("");
  const [editTitleCompany, setEditTitleCompany] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const prevProjectIdRef = useRef<string | null>(null);
  const projectsRef = useRef<ProjectRow[]>([]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Cap at ~8 lines (line-height ~1.25rem * 8 + padding).
    const max = 200;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [input]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const listedProjects = useMemo(
    () => projects.filter((p) => p.id !== UNKNOWN_PROJECT_ID),
    [projects],
  );

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  useEffect(() => {
    setTitleEditOpen(false);
  }, [projectId]);

  const currentProjectLabel = useMemo(() => {
    if (projectId === UNKNOWN_PROJECT_ID) return "New log entry";
    if (selectedProject) return `${selectedProject.name} · ${selectedProject.company}`;
    return projectId;
  }, [selectedProject, projectId]);

  const projectOverviewFacts = useMemo(() => {
    const facts = selectedProject?.knownFacts ?? [];
    const max = 12;
    return facts.slice(0, max);
  }, [selectedProject]);

  async function refreshProjects() {
    const res = await fetch("/api/projects");
    const payload = await res.json();
    setProjects(payload.projects ?? []);
  }

  function openTitleEdit() {
    if (projectId === UNKNOWN_PROJECT_ID || !selectedProject) return;
    setEditTitleName(selectedProject.name);
    setEditTitleCompany(selectedProject.company);
    setTitleEditOpen(true);
  }

  function cancelTitleEdit() {
    setTitleEditOpen(false);
  }

  async function saveTitleEdit() {
    if (projectId === UNKNOWN_PROJECT_ID) return;
    const name = editTitleName.trim();
    if (!name) {
      setStatus("Project name is required.");
      return;
    }
    setRenameBusy(true);
    try {
      const res = await fetch("/api/projects/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateDisplay",
          projectId,
          name,
          company: editTitleCompany.trim() || "Unassigned",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error ?? "Could not save name.");
        return;
      }
      await refreshProjects();
      setTitleEditOpen(false);
      setStatus("Project name saved.");
    } finally {
      setRenameBusy(false);
    }
  }

  useEffect(() => {
    refreshProjects().catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const prev = prevProjectIdRef.current;
    prevProjectIdRef.current = projectId;

    if (projectId === UNKNOWN_PROJECT_ID) {
      if (prev !== null && prev !== UNKNOWN_PROJECT_ID) {
        setMessages([
          {
            role: "assistant",
            content:
              "New log entry — what did you work on? Pick a project in the list anytime to open its saved chat.",
          },
        ]);
      }
      return;
    }

    let cancelled = false;
    setStatus("Loading chat…");

    void (async () => {
      try {
        const res = await fetch(`/api/intake/history?projectId=${encodeURIComponent(projectId)}`);
        const data = (await res.json()) as { messages?: IntakeMessage[]; retentionDays?: number };
        if (cancelled) return;
        const hist = data.messages ?? [];
        const row = projectsRef.current.find((p) => p.id === projectId);
        const label = row ? `${row.name} · ${row.company}` : projectId;
        const days = data.retentionDays ?? 30;

        if (hist.length === 0) {
          setMessages([
            {
              role: "assistant",
              content: `**${label}** — no chat in the last **${days}** days. Add an update below; older messages are removed automatically.`,
            },
          ]);
        } else {
          setMessages(
            hist.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
              channel: m.channel,
            })),
          );
        }
        setStatus("Ready");
      } catch {
        if (!cancelled) setStatus("Could not load chat history.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setProjectId(UNKNOWN_PROJECT_ID);
      setMessages([
        {
          role: "assistant",
          content:
            "Starting a **new log entry**. Describe the work; if it lines up with an older project, details will merge there instead of duplicating.",
        },
      ]);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", "/intake");
      }
    }
  }, [searchParams]);

  function startNewProjectEntry() {
    setProjectId(UNKNOWN_PROJECT_ID);
  }

  const showingProjectFile =
    selectedProject !== null && projectId !== UNKNOWN_PROJECT_ID;

  const sectionCoverageRows = useMemo(() => {
    const rows = showingProjectFile
      ? (selectedProject?.sectionHealth ?? [])
      : health;
    return rows.map((item) => (
      <li key={item.section} className="flex items-start justify-between gap-4 text-sm">
        <span className="capitalize">{item.section}</span>
        <span className="rounded-full border px-2 py-0.5 text-xs">{item.status}</span>
      </li>
    ));
  }, [showingProjectFile, selectedProject?.sectionHealth, health]);

  const projectFactsSidebar = useMemo(() => {
    if (!showingProjectFile || !selectedProject?.knownFacts?.length) return null;
    const facts = selectedProject.knownFacts;
    const max = 40;
    const shown = facts.slice(0, max);
    return (
      <>
        <h3 className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Facts on file
        </h3>
        <ul className="max-h-52 space-y-1.5 overflow-y-auto text-xs leading-snug text-slate-700">
          {shown.map((f, i) => (
            <li key={`${f.factType}-${i}-${f.value.slice(0, 24)}`} className="border-l-2 border-slate-200 pl-2">
              <span className="text-slate-500">[{f.factType}]</span> {f.value}
            </li>
          ))}
        </ul>
        {facts.length > max ? (
          <p className="mt-1 text-[10px] text-slate-400">Showing {max} of {facts.length} facts.</p>
        ) : null}
      </>
    );
  }, [showingProjectFile, selectedProject?.knownFacts]);

  async function sendMessage(message: string, inputChannel: "text" | "voice") {
    const trimmed = message.trim();
    if (!trimmed) return;

    const optimisticId = `pending-${crypto.randomUUID()}`;
    setInput("");
    setStatus("Thinking...");
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: "user",
        content: trimmed,
        channel: inputChannel,
      },
    ]);

    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          mode: INTAKE_MODE,
          projectId,
          message: trimmed,
          inputChannel,
        }),
      });

      const data = (await response.json()) as IntakeApiResponse;
      if (!response.ok || !data.userMessage || !data.assistantMessage) {
        setStatus("Request failed.");
        setInput(trimmed);
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          { role: "assistant", content: "Something went wrong. Try again." },
        ]);
        return;
      }

      const um = data.userMessage;
      const am = data.assistantMessage;
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        {
          id: um.id,
          role: um.role,
          content: um.content,
          createdAt: um.createdAt,
          channel: um.channel,
        },
        {
          id: am.id,
          role: am.role,
          content: am.content,
          createdAt: am.createdAt,
          channel: am.channel,
        },
      ]);
      setFollowUps(data.followUps);
      setHealth(data.sectionHealth);
      const ev = data.projectStoreEvents;
      if (ev?.createdIds?.length === 1 && (ev.mergedIds?.length ?? 0) > 0) {
        setProjectId(ev.createdIds[0]);
      } else if ((ev?.mergedIds?.length ?? 0) >= 1) {
        setProjectId(ev!.mergedIds![0]);
      } else if (ev?.createdIds?.length === 1) {
        setProjectId(ev.createdIds[0]);
      }
      const projectLine =
        ev?.summaries?.length ? `Projects: ${ev.summaries.join(" ")}` : null;
      setStatus(
        [data.needsProjectAssignment ? "Needs project assignment" : "Saved", projectLine]
          .filter(Boolean)
          .join(" · "),
      );
      await refreshProjects();
    } catch {
      setStatus("Request failed.");
      setInput(trimmed);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        { role: "assistant", content: "Something went wrong. Try again." },
      ]);
    }
  }

  async function onDocumentSelected(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setUploadBusy(true);
    setStatus("Uploading document…");
    try {
      const form = new FormData();
      form.set("file", file);
      if (uploadTargetId) {
        form.set("targetProjectId", uploadTargetId);
      }
      const response = await fetch("/api/projects/upload", { method: "POST", body: form });
      const data = (await response.json()) as UploadResponse;
      if (!response.ok || !data.ok) {
        setStatus(data.error ?? "Upload failed.");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "Could not import that file." },
        ]);
        return;
      }
      const summaryLines = [
        `Imported via "${data.strategy ?? "unknown"}" strategy.`,
        ...(data.summaries ?? []),
        data.mergedProjectIds?.length
          ? `Updated projects: ${data.mergedProjectIds.join(", ")}`
          : null,
        data.createdProjectIds?.length
          ? `New projects: ${data.createdProjectIds.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      setMessages((prev) => [...prev, { role: "user", content: `Uploaded: ${file.name}` }]);
      setMessages((prev) => [...prev, { role: "assistant", content: summaryLines }]);
      setStatus("Import complete");
      await refreshProjects();
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(input, "text");
  }

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      setStatus("Transcribing...");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
    recorder.onstop = async () => {
      const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.set("audio", new File([audioBlob], "clip.webm", { type: "audio/webm" }));

      const response = await fetch("/api/transcribe", { method: "POST", body: formData });
      const payload = await response.json();
      const transcript = payload.text ?? "";
      if (transcript) {
        setInput(transcript);
        setStatus("Transcribed — review or edit, then press Send.");
        setTimeout(() => messageInputRef.current?.focus(), 0);
      } else {
        setStatus("Transcription failed, type instead.");
      }
      stream.getTracks().forEach((track) => track.stop());
    };

    recorder.start();
    recorderRef.current = recorder;
    setIsRecording(true);
    setStatus("Listening...");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-7xl gap-4 px-4 py-4">
        {projectsOpen && (
          <aside className="w-64 shrink-0 rounded-xl border bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Projects</h2>
              <button
                className="text-xs text-slate-500"
                onClick={() => setProjectsOpen(false)}
                type="button"
              >
                Hide
              </button>
            </div>
            <button
              type="button"
              className="mb-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-left text-sm font-medium text-white hover:bg-slate-800"
              onClick={startNewProjectEntry}
            >
              New log entry
            </button>
            <p className="mb-2 text-[11px] leading-snug text-slate-500">
              Opens a fresh log. If your text matches past work, it updates that project instead of duplicating.
            </p>
            <ul className="space-y-2">
              {listedProjects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border p-2 text-left ${
                      project.id === projectId
                        ? "hover:bg-slate-100"
                        : "border-slate-300 bg-slate-50 hover:bg-slate-100"
                    }`}
                    onClick={() => setProjectId(project.id)}
                  >
                    <p className="text-sm font-medium">{project.name}</p>
                    <p className="text-xs text-slate-500">{project.company}</p>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <main className="min-w-0 flex-1 rounded-xl border bg-white p-4 shadow-sm">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {projectId === UNKNOWN_PROJECT_ID ? "Logging" : "Editing project"}
              </p>
              {projectId !== UNKNOWN_PROJECT_ID && titleEditOpen && selectedProject ? (
                <div className="mt-1 flex flex-wrap items-center gap-2" role="group" aria-label="Edit project title">
                  <input
                    className="min-w-[8rem] max-w-[14rem] rounded-md border border-slate-300 px-2 py-1 text-base font-semibold text-slate-900"
                    value={editTitleName}
                    onChange={(e) => setEditTitleName(e.target.value)}
                    disabled={renameBusy}
                    autoFocus
                    autoComplete="off"
                    aria-label="Project name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveTitleEdit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelTitleEdit();
                      }
                    }}
                  />
                  <span className="text-slate-400" aria-hidden>
                    ·
                  </span>
                  <input
                    className="min-w-[6rem] max-w-[12rem] rounded-md border border-slate-300 px-2 py-1 text-base font-semibold text-slate-900"
                    value={editTitleCompany}
                    onChange={(e) => setEditTitleCompany(e.target.value)}
                    disabled={renameBusy}
                    autoComplete="organization"
                    aria-label="Company"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveTitleEdit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelTitleEdit();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    onClick={() => void saveTitleEdit()}
                    disabled={renameBusy}
                  >
                    {renameBusy ? "…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    onClick={cancelTitleEdit}
                    disabled={renameBusy}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <h1
                  className={`text-lg font-semibold ${
                    projectId !== UNKNOWN_PROJECT_ID ? "cursor-text select-text" : ""
                  }`}
                  onDoubleClick={projectId !== UNKNOWN_PROJECT_ID ? openTitleEdit : undefined}
                  title={
                    projectId !== UNKNOWN_PROJECT_ID
                      ? "Double-click to edit name and company"
                      : undefined
                  }
                >
                  {currentProjectLabel}
                </h1>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link href="/dashboard" className="rounded-lg border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Dashboard
              </Link>
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => setProjectsOpen((value) => !value)}
              >
                {projectsOpen ? "Hide list" : "Projects"}
              </button>
            </div>
          </header>

          {selectedProject && projectId !== UNKNOWN_PROJECT_ID && (
            <section
              className="mb-4 rounded-lg border border-slate-200 bg-slate-50/90 p-3 text-sm text-slate-800"
              aria-labelledby="project-overview-heading"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200/80 pb-2">
                <div>
                  <h2 id="project-overview-heading" className="text-sm font-semibold text-slate-700">
                    Project details
                  </h2>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>
                    <span className="font-medium text-slate-700">{selectedProject.status}</span>
                    <span className="mx-1 text-slate-300">·</span>
                    Updated {new Date(selectedProject.updatedAt).toLocaleString()}
                  </p>
                  {(selectedProject.labels?.length ?? 0) > 0 && (
                    <p className="mt-1 max-w-[14rem] text-[11px] leading-snug text-slate-500">
                      {selectedProject.labels?.join(", ")}
                    </p>
                  )}
                </div>
              </div>
              {selectedProject.currentFocusArea?.trim() ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-700">
                  <span className="font-semibold text-slate-600">Focus: </span>
                  {selectedProject.currentFocusArea}
                </p>
              ) : null}
              {(selectedProject.sectionHealth?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Section status
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {selectedProject.sectionHealth?.map((s) => (
                      <li
                        key={s.section}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]"
                      >
                        <span className="capitalize text-slate-700">{s.section}</span>
                        <span className="mx-1 text-slate-300">·</span>
                        <span className="text-slate-500">{s.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Stored notes
                </p>
                {projectOverviewFacts.length === 0 ? (
                  <p className="text-xs italic text-slate-500">
                    No facts stored yet — log work in chat or import a document for this project.
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-xs leading-snug text-slate-700">
                    {projectOverviewFacts.map((f, i) => (
                      <li key={`${f.factType}-${i}`} className="border-l-2 border-slate-200 pl-2">
                        <span className="text-slate-500">[{f.factType}]</span> {f.value}
                      </li>
                    ))}
                    {(selectedProject.knownFacts?.length ?? 0) > projectOverviewFacts.length ? (
                      <li className="pl-2 text-slate-400">…</li>
                    ) : null}
                  </ul>
                )}
              </div>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
            <section className="rounded-xl border bg-slate-50 p-3">
              <div
                ref={messagesScrollRef}
                className="mb-3 max-h-[420px] space-y-3 overflow-y-auto p-1"
              >
                {messages.map((message, index) => (
                  <div
                    key={message.id ?? `${message.role}-${index}-${message.createdAt ?? ""}`}
                    className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                      message.role === "assistant"
                        ? "bg-white border"
                        : "ml-auto bg-slate-900 text-white"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    {message.createdAt ? (
                      <p
                        className={`mt-1.5 text-[10px] tabular-nums ${
                          message.role === "assistant" ? "text-slate-400" : "text-slate-300"
                        }`}
                      >
                        {new Date(message.createdAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <form className="flex items-end gap-2" onSubmit={onSubmit}>
                <textarea
                  ref={messageInputRef}
                  rows={1}
                  className="flex-1 resize-none overflow-y-auto rounded-lg border px-3 py-2 text-sm leading-5"
                  placeholder="Type your update or use the mic..."
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void sendMessage(input, "text");
                    }
                  }}
                  readOnly={isRecording}
                  aria-busy={isRecording}
                />
                <button
                  type="button"
                  title={isRecording ? "Stop recording and transcribe" : "Record voice"}
                  aria-label={isRecording ? "Stop recording and transcribe" : "Start voice recording"}
                  className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-slate-600 transition-colors ${
                    isRecording
                      ? "border-rose-300/60 bg-rose-50/80 text-rose-800 hover:bg-rose-100/80"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                  onClick={toggleRecording}
                >
                  {isRecording ? (
                    <>
                      <span
                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500/70"
                        aria-hidden
                      />
                      <StopRecordingIcon className="h-4 w-4" />
                    </>
                  ) : (
                    <MicIcon className="h-4 w-4" />
                  )}
                </button>
                <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
                  Send
                </button>
              </form>
              <p className="mt-2 text-xs text-slate-500" aria-live="polite">
                {status}
              </p>

              <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">Import document</p>
                <p className="mt-1 text-xs text-slate-500">
                  Resume, exported chat (.txt / .md), or PDF. With an API key, imports merge into matching
                  projects, create new ones, and can rename or refresh scope when the document shows a change.
                  Leave target empty for automatic matching.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.pdf,.json,text/plain,text/markdown,application/pdf,application/json"
                    className="max-w-full text-xs"
                    disabled={uploadBusy}
                    onChange={(e) => void onDocumentSelected(e.target.files)}
                  />
                  <select
                    className="rounded border px-2 py-1 text-xs"
                    value={uploadTargetId}
                    onChange={(e) => setUploadTargetId(e.target.value)}
                    disabled={uploadBusy}
                  >
                    <option value="">Auto (match or create)</option>
                    {listedProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        Force into: {p.name} ({p.company})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <aside className="rounded-xl border p-3">
              <h2 className="mb-2 text-sm font-semibold">Known Information</h2>
              <p className="mb-2 text-[11px] leading-snug text-slate-400">
                {showingProjectFile
                  ? "From your saved project: section coverage and structured notes on file."
                  : "From your latest reply only — open a project to see everything stored for it."}
              </p>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {showingProjectFile ? "Section coverage (saved)" : "Section coverage (this reply)"}
              </h3>
              <ul className="space-y-2">
                {sectionCoverageRows.length > 0 ? (
                  sectionCoverageRows
                ) : (
                  <li className="text-sm text-slate-500">
                    {showingProjectFile
                      ? "No section status stored yet for this project."
                      : "Send a message to see how it maps to resume-style sections."}
                  </li>
                )}
              </ul>
              {projectFactsSidebar}
              {followUps.length > 0 && (
                <>
                  <h3 className="mt-4 mb-2 text-sm font-semibold">Suggested follow-ups</h3>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {followUps.map((question, index) => (
                      <li key={`${question}-${index}`} className="rounded-lg bg-slate-50 p-2">
                        {question}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function IntakePageRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
          Loading…
        </div>
      }
    >
      <IntakePage />
    </Suspense>
  );
}
