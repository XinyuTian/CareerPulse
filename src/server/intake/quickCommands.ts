import type { ProjectSnapshot } from "@/server/intake/contracts";

const UNKNOWN_IDS = new Set(["proj-unknown", ""]);

export interface QuickCommandContext {
  projectId?: string;
  projects: ProjectSnapshot[];
}

export interface QuickCommandResult {
  reply: string;
  /** When true, skip LLM project planning and main chat completion for this turn. */
  skipLlm: boolean;
}

function formatProjectLine(p: ProjectSnapshot): string {
  const labels = p.labels?.length ? ` · ${p.labels.slice(0, 4).join(", ")}` : "";
  return `• **${p.name}** (${p.company}) — \`${p.id}\`${labels}`;
}

function currentProject(ctx: QuickCommandContext): ProjectSnapshot | null {
  const id = ctx.projectId?.trim() ?? "";
  if (!id || UNKNOWN_IDS.has(id)) return null;
  return ctx.projects.find((p) => p.id === id) ?? null;
}

/**
 * Handles short directive-style messages without calling the LLM.
 * Extend patterns here as new “orders” are needed.
 */
export function tryIntakeQuickCommand(message: string, ctx: QuickCommandContext): QuickCommandResult | null {
  const raw = message.trim();
  if (raw.length < 2 || raw.length > 280) return null;
  const q = raw.toLowerCase().replace(/[?.!…]+$/u, "").trim();

  const isHelp =
    /^(help|what can you do|\?|commands?)\s*\.?$/.test(q) ||
    /^what (are |is )your commands/.test(q);
  if (isHelp) {
    return {
      skipLlm: true,
      reply: [
        "Here are quick **commands** I handle without a long model reply:",
        "",
        "• **Current project** — e.g. “what project am I on?”, “show the current project”, “which project is selected?”",
        "• **List projects** — e.g. “list all my projects”, “what projects do I have?”",
        "• **Count** — e.g. “how many projects do I have?”",
        "• **Recent activity** — e.g. “which project was updated most recently?”",
        "• **Summarize current** — e.g. “summarize this project”, “bullet the facts for the current project”",
        "",
        "Anything else: describe your work and I will ask follow-ups and file it under the right project when possible.",
      ].join("\n"),
    };
  }

  const asksCurrent =
    /^(what('s|s| is) my current project|what project am i on|which project am i on|which project (is|am i) (selected|open|active)|show (me )?(the )?current project|current project\??)$/.test(
      q,
    ) ||
    /^(what project (are we|is this))/.test(q);
  if (asksCurrent) {
    const cur = currentProject(ctx);
    if (!cur) {
      return {
        skipLlm: true,
        reply:
          "You are on the **new log** row (no specific historical project selected). Choose a project in the sidebar, or keep logging — if it matches past work, it can merge into that project automatically.",
      };
    }
    const factCount = cur.knownFacts?.length ?? 0;
    return {
      skipLlm: true,
      reply: [
        `**Current project:** ${cur.name} (${cur.company})`,
        `**Id:** \`${cur.id}\` · **Status:** ${cur.status}`,
        cur.currentFocusArea?.trim() ? `**Focus:** ${cur.currentFocusArea}` : null,
        `**Stored facts:** ${factCount}`,
        `**Updated:** ${new Date(cur.updatedAt).toLocaleString()}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const asksList =
    /^(list (all )?(my )?projects|show (all )?(my )?projects|what projects do i have|what are my projects|all projects)\??$/.test(
      q,
    );
  if (asksList) {
    const rows = ctx.projects.filter((p) => !UNKNOWN_IDS.has(p.id));
    if (!rows.length) {
      return { skipLlm: true, reply: "You do not have any saved projects yet (only the empty “new log” bucket)." };
    }
    const lines = rows.map(formatProjectLine);
    return {
      skipLlm: true,
      reply: [`You have **${rows.length}** project(s):`, "", ...lines].join("\n"),
    };
  }

  const asksCount = /^(how many projects)/.test(q);
  if (asksCount) {
    const n = ctx.projects.filter((p) => !UNKNOWN_IDS.has(p.id)).length;
    return { skipLlm: true, reply: `You have **${n}** saved project(s) (not counting the generic new-log row).` };
  }

  const asksRecent =
    /^(which project (was |did )?updated (most )?recently|most recently updated project|latest project update)\??$/.test(
      q,
    );
  if (asksRecent) {
    const rows = [...ctx.projects].filter((p) => !UNKNOWN_IDS.has(p.id));
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const top = rows[0];
    if (!top) {
      return { skipLlm: true, reply: "No projects with update timestamps yet." };
    }
    return {
      skipLlm: true,
      reply: `Most recently updated: **${top.name}** (${top.company}) — \`${top.id}\` at ${new Date(top.updatedAt).toLocaleString()}.`,
    };
  }

  const asksSummarize =
    /^(summarize (this|the current) project|project summary|bullet(s)? (for )?(the )?current project|facts for (this|the current) project)\??$/.test(
      q,
    );
  if (asksSummarize) {
    const cur = currentProject(ctx);
    if (!cur) {
      return {
        skipLlm: true,
        reply: "No project is selected. Pick one in the sidebar or ask “list all my projects.”",
      };
    }
    const facts = cur.knownFacts ?? [];
    if (!facts.length) {
      return {
        skipLlm: true,
        reply: `**${cur.name}** has no stored facts yet. Log an update in chat or import a document.`,
      };
    }
    const bullets = facts.slice(0, 20).map((f) => `• [${f.factType}] ${f.value}`);
    const more = facts.length > 20 ? `… and ${facts.length - 20} more.` : "";
    return {
      skipLlm: true,
      reply: [`**${cur.name}** (${cur.company}) — key facts:`, "", ...bullets, more].filter(Boolean).join("\n"),
    };
  }

  return null;
}
