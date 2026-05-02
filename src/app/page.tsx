import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <main className="w-full max-w-3xl rounded-2xl border bg-white p-8 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-500">Career Ledger</p>
        <h1 className="mt-3 text-3xl font-semibold">Project-centered career copilot</h1>
        <p className="mt-3 text-slate-600">
          Capture ongoing and past experiences with guided clarifying questions, keep facts structured by
          project, and prepare reusable material for resumes and behavioral interviews.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/intake?new=1" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            Start Intake Chat
          </Link>
          <Link href="/dashboard" className="rounded-lg border px-4 py-2 text-sm">
            Open Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
