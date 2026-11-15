/** Bottom padding of the app's <main> (py-10), kept free under the chat card. */
const PAGE_PAD = 40;
/** Sticky top nav (h-16) plus a little air. */
const NAV = 80;
const MIN = 420;

/**
 * Height for the coach chat card so the page itself never needs to scroll: from the card's top (document
 * offset) to the bottom of the screen. When too little is left (phones: header and tabs take most of the
 * screen), the card fills the screen under the nav instead, docked after one small page scroll.
 */
export function chatHeight(viewport: number, top: number) {
  const left = viewport - top - PAGE_PAD;
  return Math.round(left >= MIN ? left : Math.max(240, viewport - NAV));
}
