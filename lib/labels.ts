export { RELATIONS } from "./ai/prompt";

export function timeAgo(d: Date) {
  const s = (Date.now() - d.getTime()) / 1000;
  const units: [number, Intl.RelativeTimeFormatUnit][] = [[60, "second"], [60, "minute"], [24, "hour"], [30, "day"], [12, "month"], [Infinity, "year"]];
  let v = s;
  for (const [n, u] of units) {
    if (Math.abs(v) < n) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.round(v), u);
    v /= n;
  }
  return "";
}
