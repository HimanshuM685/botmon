import "server-only";
import { db } from "./db";
import { alive } from "./trash";
import { checkGoals, goalsForPrompt } from "./goals";

/** The person's score goals, for read prompts: "" when they are working on none. */
export async function goalsPrompt(personId: string) {
  return goalsForPrompt(await db.scoreGoal.findMany({ where: { personId, ...alive } }));
}

/** After a read is saved: goals its scores reached are marked achieved, with the level reached. */
export async function markReachedGoals(personId: string, signals: unknown) {
  const goals = await db.scoreGoal.findMany({ where: { personId, ...alive, achievedAt: null } });
  const reached = checkGoals(goals, signals as Parameters<typeof checkGoals>[1]);
  if (!reached.length) return;
  const at = new Date();
  await db.$transaction(reached.map((r) => db.scoreGoal.update({ where: { id: r.id }, data: { achievedAt: at, toLevel: r.toLevel } })));
}
