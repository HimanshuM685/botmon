// Netlify scheduled function: once a day, ask the app to purge trash older than 30 days.
// Needs CRON_SECRET set in the Netlify site env (same value the app reads).
const purge = async () => {
  const res = await fetch(`${process.env.URL}/api/cron/purge`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("purge", res.status, await res.text());
};

export default purge;
export const config = { schedule: "@daily" };
