import type { Msg } from "./parsers/types";

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
  last30Theirs: number;
  prev30Theirs: number;
  lastMessageAt: number;
  lastSender: "me" | "them";
};

const NEW_CONVO_GAP = 6 * 3600_000;

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] / 60_000);
}

export function computeStats(msgs: Msg[], me: string): ChatStats {
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
  for (const m of theirs) hours[new Date(m.ts).getHours()]++;
  const end = msgs.at(-1)?.ts ?? 0;
  const inWindow = (from: number, to: number) => theirs.filter((m) => m.ts > end - from && m.ts <= end - to).length;
  const avgLen = (xs: Msg[]) => (xs.length ? Math.round(xs.reduce((n, m) => n + m.text.length, 0) / xs.length) : 0);

  return {
    total: msgs.length,
    mine: mine.length,
    theirs: theirs.length,
    days: msgs.length ? Math.max(1, Math.round((end - msgs[0].ts) / 86_400_000)) : 0,
    theyInitiatePct: starts ? Math.round((theyStart / starts) * 100) : 0,
    myMedianReplyMin: median(myReplies),
    theirMedianReplyMin: median(theirReplies),
    myAvgLen: avgLen(mine),
    theirAvgLen: avgLen(theirs),
    theirTopHours: hours.map((n, h) => [n, h]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter(([n]) => n > 0).map(([, h]) => h),
    last30Theirs: inWindow(30 * 86_400_000, 0),
    prev30Theirs: inWindow(60 * 86_400_000, 30 * 86_400_000),
    lastMessageAt: end,
    lastSender: msgs.length && isMe(msgs[msgs.length - 1]) ? "me" : "them",
  };
}
