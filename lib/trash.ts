export const TRASH_DAYS = 30;
const DAY = 86_400_000;

/** Prisma filter for rows that are not in the trash. */
export const alive = { deletedAt: null } as const;

/** Rows deleted before this moment are past the 30-day window and get purged. */
export const purgeCutoff = (now = Date.now()) => new Date(now - TRASH_DAYS * DAY);

export const purgeDate = (deletedAt: Date) => new Date(deletedAt.getTime() + TRASH_DAYS * DAY);

export const daysLeft = (deletedAt: Date, now = Date.now()) =>
  Math.max(0, Math.ceil((purgeDate(deletedAt).getTime() - now) / DAY));
