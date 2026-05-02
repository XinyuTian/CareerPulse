export interface CheckInTask {
  id: string;
  type: "weekly" | "monthly" | "nudge";
  title: string;
  prompt: string;
  scheduledFor: string;
  reason: string;
}

interface SchedulerInput {
  now?: Date;
  lastActivityAt?: Date;
  staleProjects: string[];
  weeklyCadenceDay?: number;
}

export function generateCheckInTasks(input: SchedulerInput): CheckInTask[] {
  const now = input.now ?? new Date();
  const tasks: CheckInTask[] = [];
  const weeklyCadenceDay = input.weeklyCadenceDay ?? 1;

  const daysToWeekly = (7 + weeklyCadenceDay - now.getDay()) % 7;
  const weeklyDate = new Date(now);
  weeklyDate.setDate(now.getDate() + daysToWeekly);
  weeklyDate.setHours(9, 0, 0, 0);

  tasks.push({
    id: crypto.randomUUID(),
    type: "weekly",
    title: "Weekly career update",
    prompt: "Any wins, blockers, or scope changes this week?",
    scheduledFor: weeklyDate.toISOString(),
    reason: "Primary weekly check-in cadence.",
  });

  if (now.getDate() <= 3) {
    const monthlyDate = new Date(now.getFullYear(), now.getMonth(), 3, 9, 0, 0, 0);
    tasks.push({
      id: crypto.randomUUID(),
      type: "monthly",
      title: "Monthly reflection",
      prompt: "What changed in your growth goals or strongest project stories this month?",
      scheduledFor: monthlyDate.toISOString(),
      reason: "Monthly synthesis for growth and resume readiness.",
    });
  }

  if (input.staleProjects.length > 0) {
    tasks.push({
      id: crypto.randomUUID(),
      type: "nudge",
      title: "Refresh stale project details",
      prompt: `Project details look stale for: ${input.staleProjects.join(", ")}. Any updates?`,
      scheduledFor: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      reason: "Event-triggered nudge due to stale project sections.",
    });
  }

  if (input.lastActivityAt) {
    const elapsedMs = now.getTime() - input.lastActivityAt.getTime();
    if (elapsedMs >= 10 * 24 * 60 * 60 * 1000) {
      tasks.push({
        id: crypto.randomUUID(),
        type: "nudge",
        title: "Gentle re-engagement",
        prompt: "No pressure—want to log a quick update from recent work?",
        scheduledFor: now.toISOString(),
        reason: "No activity in 10+ days.",
      });
    }
  }

  return tasks.slice(0, 2);
}
