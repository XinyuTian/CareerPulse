/**
 * Extract plain text from supported upload types (plain text, Markdown, PDF).
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_CHARS = 160_000;

export async function extractDocumentText(file: File): Promise<{ text: string; mime: string }> {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (name.endsWith(".pdf") || type === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    // Next/Turbopack bundles pdfjs with a bogus chunk worker path; point at the real file.
    const workerFile = path.join(
      process.cwd(),
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    );
    PDFParse.setWorker(pathToFileURL(workerFile).href);

    const data = new Uint8Array(await file.arrayBuffer());
    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return { text: truncate(result.text), mime: "application/pdf" };
    } finally {
      await parser.destroy();
    }
  }

  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    type === "text/plain" ||
    type === "text/markdown"
  ) {
    const text = await file.text();
    return { text: truncate(text), mime: type || "text/plain" };
  }

  if (name.endsWith(".json") || type === "application/json") {
    const text = await file.text();
    return { text: truncate(text), mime: "application/json" };
  }

  throw new Error("Unsupported file type. Use .txt, .md, .json, or .pdf.");
}

function truncate(text: string) {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (t.length <= MAX_CHARS) return t;
  return `${t.slice(0, MAX_CHARS)}\n\n[truncated]`;
}
