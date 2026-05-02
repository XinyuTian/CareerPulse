/**
 * Split uploaded notes into one or more project-shaped chunks.
 * Supports Markdown ##/### headers; otherwise treats the file as a single block.
 */

export interface IngestChunk {
  title: string;
  company: string;
  body: string;
}

function lineCompanyHint(line: string): string | null {
  const m = line.match(/^\s*(?:company|org|employer)\s*[:—-]\s*(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function inferCompanyFromBody(body: string): string {
  const firstLines = body.split("\n").slice(0, 8);
  for (const line of firstLines) {
    const hint = lineCompanyHint(line);
    if (hint) return hint;
  }
  const at = body.match(/\bat\s+([A-Z][\w.&\s-]{2,40})\b/);
  if (at?.[1]) return at[1].trim();
  return "Unassigned";
}

function titleFromFirstLine(text: string): { title: string; rest: string } {
  const lines = text.trim().split("\n");
  const first = lines[0]?.trim() ?? "Imported update";
  const rest = lines.slice(1).join("\n").trim();
  if (first.length <= 100 && rest.length > 0) {
    return { title: first, rest };
  }
  return { title: "Imported update", rest: text.trim() };
}

/**
 * Headers like `# Title`, `## Title` at line start start a new section.
 */
export function parseIngestDocument(raw: string): IngestChunk[] {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) {
    return [];
  }

  const parts = text.split(/(?=^#{1,3}\s+.+$)/m).map((s) => s.trim()).filter(Boolean);
  const withHeaders = parts.filter((p) => /^#{1,3}\s+/m.test(p));
  const preamble = parts.filter((p) => !/^#{1,3}\s+/m.test(p)).join("\n\n").trim();

  if (withHeaders.length > 0) {
    const chunks: IngestChunk[] = [];
    for (const block of withHeaders) {
      const m = block.match(/^#{1,3}\s+(.+)$/m);
      const titleLine = m?.[1]?.trim() ?? "Imported update";
      const body = block.replace(/^#{1,3}\s+.+$/m, "").trim();
      const company = inferCompanyFromBody(body);
      chunks.push({ title: titleLine, company, body: body || titleLine });
    }
    if (preamble && chunks.length > 0) {
      chunks[0] = {
        ...chunks[0],
        body: `${preamble}\n\n${chunks[0].body}`.trim(),
        company: chunks[0].company === "Unassigned" ? inferCompanyFromBody(preamble) : chunks[0].company,
      };
    }
    return chunks;
  }

  const { title, rest } = titleFromFirstLine(text);
  const body = rest || text;
  return [{ title, company: inferCompanyFromBody(body), body }];
}
