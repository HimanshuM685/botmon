import type { Msg } from "./parsers/types";

const DAY = 86_400_000;
const NEW_CONVO_GAP = 6 * 3600_000;

/** Computed once at upload and stored on ChatUpload. Hours are in the chat's local time. */
export type ChatStats = {
  total: number;
  mine: number;
  theirs: number;
  days: number;
  theyInitiatePct: number;
  myMedianReplyMin: number | null;
  theirMedianReplyMin: number | null;
  myAvgLen: number;
  theirAvgLen: number;
  theirTopHours: number[];
  lastMessageAt: number;
  lastSender: "me" | "them";
  /** Their message timestamps from the final 60 days of the chat, for "last 30 days" windows measured from today. */
  recentTheirTs: number[];
};

export type ActivityWindows = { last30: number; prev30: number; daysSinceLast: number };

/**
 * `tzOffsetMin` is the uploader's `Date#getTimezoneOffset()` (minutes, UTC minus local),
 * so local wall-clock = ts - tzOffsetMin * 60_000. Server code runs in UTC; never use local-time getters there.
 */
export const toLocal = (ts: number, tzOffsetMin: number) => new Date(ts - tzOffsetMin * 60_000);

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] / 60_000);
}

export function computeStats(msgs: Msg[], me: string, tzOffsetMin = 0): ChatStats {
  const isMe = (m: Msg) => m.sender === me;
  const mine = msgs.filter(isMe);
  const theirs = msgs.filter((m) => !isMe(m));
  let starts = 0, theyStart = 0;
  const myReplies: number[] = [], theirReplies: number[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const gap = i ? msgs[i].ts - msgs[i - 1].ts : Infinity;
    if (gap > NEW_CONVO_GAP) {
      starts++;
      if (!isMe(msgs[i])) theyStart++;
    } else if (isMe(msgs[i]) !== isMe(msgs[i - 1])) {
      (isMe(msgs[i]) ? myReplies : theirReplies).push(gap);
    }
  }
  const hours = new Array(24).fill(0);
  for (const m of theirs) hours[toLocal(m.ts, tzOffsetMin).getUTCHours()]++;
  const end = msgs.at(-1)?.ts ?? 0;
  const avgLen = (xs: Msg[]) => (xs.length ? Math.round(xs.reduce((n, m) => n + m.text.length, 0) / xs.length) : 0);

  return {
    total: msgs.length,
    mine: mine.length,
    theirs: theirs.length,
    days: msgs.length ? Math.max(1, Math.round((end - msgs[0].ts) / DAY)) : 0,
    theyInitiatePct: starts ? Math.round((theyStart / starts) * 100) : 0,
    myMedianReplyMin: median(myReplies),
    theirMedianReplyMin: median(theirReplies),
    myAvgLen: avgLen(mine),
    theirAvgLen: avgLen(theirs),
    theirTopHours: hours.map((n, h) => [n, h]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter(([n]) => n > 0).map(([, h]) => h),
    lastMessageAt: end,
    lastSender: msgs.length && isMe(msgs[msgs.length - 1]) ? "me" : "them",
    recentTheirTs: theirs.filter((m) => m.ts > end - 60 * DAY).map((m) => m.ts),
  };
}

/** Activity measured back from `now`, not from the last message, so a chat that went quiet shows as quiet. */
export function activityWindows(s: ChatStats, now = Date.now()): ActivityWindows {
  const count = (from: number, to: number) => s.recentTheirTs.filter((t) => t > now - from * DAY && t <= now - to * DAY).length;
  return {
    last30: count(30, 0),
    prev30: count(60, 30),
    daysSinceLast: s.lastMessageAt ? Math.max(0, Math.floor((now - s.lastMessageAt) / DAY)) : 0,
  };
}
