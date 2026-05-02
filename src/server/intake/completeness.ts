import type {
  SectionKey,
  SectionHealth,
  SectionHealthStatus,
  StructuredFact,
} from "@/server/intake/contracts";

const SECTION_RULES: Record<SectionKey, RegExp[]> = {
  background: [/\b(company|team|role|timeline|year|month)\b/i],
  scope: [/\b(problem|scope|user|customer|constraint)\b/i],
  contributions: [/\b(i|my|owned|built|led|implemented|designed)\b/i],
  outcomes: [/\b(metric|improve|reduced|increased|impact|result|kpi|%\b)\b/i],
  story: [/\b(situation|task|action|result|challenge)\b/i],
};

export function extractStructuredFacts(input: string): StructuredFact[] {
  const facts: StructuredFact[] = [];
  const metricMatch = input.match(/(\d+%|\$?\d+(?:\.\d+)?\s?(?:k|m|b)?)/gi);
  if (metricMatch?.length) {
    facts.push({
      factType: "outcome_metric",
      value: metricMatch.join(", "),
      confidence: "INFERRED",
    });
  }

  if (/\b(stakeholder|customer|manager|cross-functional)\b/i.test(input)) {
    facts.push({
      factType: "stakeholders",
      value: input,
      confidence: "INFERRED",
    });
  }

  if (!facts.length) {
    facts.push({
      factType: "freeform_update",
      value: input,
      confidence: "INFERRED",
    });
  }

  return facts;
}

export function computeSectionHealth(input: string, staleSections: string[] = []): SectionHealth[] {
  const lowered = input.toLowerCase();

  return (Object.keys(SECTION_RULES) as SectionKey[]).map((section) => {
    const hasSignal = SECTION_RULES[section].some((pattern) => pattern.test(lowered));
    let status: SectionHealthStatus = hasSignal ? "GOOD" : "MISSING";
    let reason = hasSignal
      ? "Recent answers include this section."
      : "Missing high-signal details for this section.";

    if (staleSections.includes(section)) {
      status = "STALE";
      reason = "Section was previously complete but likely changed.";
    }

    return { section, status, reason };
  });
}

export function buildFollowUpQuestions(health: SectionHealth[]): string[] {
  const priorities = health
    .filter((entry) => entry.status === "MISSING" || entry.status === "STALE")
    .slice(0, 2);

  return priorities.map((entry) => {
    if (entry.section === "outcomes") {
      return "What measurable result or evidence can we attach to this update?";
    }
    if (entry.section === "background") {
      return "Which project, role context, or timeline period does this belong to?";
    }
    if (entry.section === "scope") {
      return "What problem or user need were you addressing?";
    }
    if (entry.section === "contributions") {
      return "What did you personally own or drive in this work?";
    }
    return "Could you fill the missing STAR details (situation/task/action/result)?";
  });
}
