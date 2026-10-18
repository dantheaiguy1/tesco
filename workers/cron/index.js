// Calls POST /api/cron/run on the ShopShot site. The endpoint does the work
// (lifecycle emails, analytics bot cleanup) and is idempotent, so a retried
// or doubled run is harmless.
export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(env.TARGET_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const body = await res.text();
    console.log(`[shopshot-cron] ${res.status} ${body.slice(0, 500)}`);
    if (!res.ok) throw new Error(`cron run failed: ${res.status}`);
  },
};
