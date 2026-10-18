/**
 * Moves existing images from D1 into the shopshot-images R2 bucket.
 *
 * New images already go to R2 (see "IMAGE STORAGE (R2)" in src/index.tsx).
 * This script handles rows written before that: it uploads each base64
 * image_data to R2 and records the object key in image_key. It is resumable
 * (it only picks rows with no image_key) and safe to stop at any point.
 *
 * By default image_data is KEPT after upload, so a rollback to the previous
 * build loses nothing. Run again with --clear-data once you are happy, to
 * free the space in D1 (image_data is set to '' because the column is
 * NOT NULL in production).
 *
 * Usage (from the repo root; tsx is fetched by npx):
 *
 *   export CLOUDFLARE_API_TOKEN=...   # needs D1 Edit and Workers R2 Storage Edit
 *   export CLOUDFLARE_ACCOUNT_ID=...
 *   npx tsx scripts/migrate-images-to-r2.ts --dry-run
 *   npx tsx scripts/migrate-images-to-r2.ts
 *   npx tsx scripts/migrate-images-to-r2.ts --ledger        # credit_transactions.image_data too
 *   npx tsx scripts/migrate-images-to-r2.ts --clear-data    # after checking the site
 *
 * Options:
 *   --dry-run      count and list what would move, change nothing
 *   --ledger       migrate credit_transactions.image_data (old ledger copies)
 *   --clear-data   for rows already in R2, blank image_data in D1
 *   --limit N      stop after N rows (default: all)
 *
 * Optional env: D1_DATABASE_ID (default: production), R2_BUCKET (default
 * shopshot-images).
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const DATABASE_ID = process.env.D1_DATABASE_ID || '7418ff05-a1c5-41d5-8238-4c1373e2b4f6';
const BUCKET = process.env.R2_BUCKET || 'shopshot-images';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LEDGER = args.includes('--ledger');
const CLEAR = args.includes('--clear-data');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;

const TABLE = LEDGER ? 'credit_transactions' : 'generated_images';
const CONCURRENCY = 4;
const PAGE = 50;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN first.');
  process.exit(1);
}

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

async function d1<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(`${API}/d1/database/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body: any = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(`D1 query failed (${res.status}): ${JSON.stringify(body.errors || body).slice(0, 300)}`);
  }
  return (body.result?.[0]?.results || []) as T[];
}

async function r2Put(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const res = await fetch(`${API}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': contentType },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`R2 put ${key} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { bytes: Buffer.from(m[2], 'base64'), contentType: m[1] };
}

function extFor(contentType: string): string {
  return contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
}

async function clearMigrated(): Promise<void> {
  const [{ n }] = await d1<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${TABLE} WHERE image_key IS NOT NULL AND image_data IS NOT NULL AND image_data != ''`
  );
  console.log(`${n} ${TABLE} rows are in R2 and still hold image_data.`);
  if (DRY_RUN || n === 0) return;
  // Blank in small batches to stay well inside D1's per-query limits.
  let cleared = 0;
  for (;;) {
    const ids = await d1<{ id: string | number }>(
      `SELECT id FROM ${TABLE} WHERE image_key IS NOT NULL AND image_data IS NOT NULL AND image_data != '' LIMIT 200`
    );
    if (!ids.length) break;
    await d1(`UPDATE ${TABLE} SET image_data = '' WHERE id IN (${ids.map(() => '?').join(',')})`, ids.map(r => r.id));
    cleared += ids.length;
    console.log(`  cleared ${cleared}/${n}`);
  }
}

async function migrate(): Promise<void> {
  const [{ n }] = await d1<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${TABLE} WHERE image_key IS NULL AND image_data IS NOT NULL AND image_data LIKE 'data:%'`
  );
  console.log(`${n} ${TABLE} rows to move to R2 bucket ${BUCKET}${DRY_RUN ? ' (dry run)' : ''}.`);
  if (DRY_RUN || n === 0) return;

  let done = 0;
  let failed = 0;
  let lastId: string | number = LEDGER ? '' : 0;
  const skip = new Set<string | number>(); // rows that failed this run

  while (done + failed < Math.min(n, LIMIT)) {
    // Keyset pagination on id, so failed rows are not retried in a loop.
    const page = await d1<{ id: string | number; session_id: string | null; idx: number | null }>(
      LEDGER
        ? `SELECT id, session_id, NULL AS idx FROM credit_transactions
           WHERE image_key IS NULL AND image_data LIKE 'data:%' AND id > ? ORDER BY id LIMIT ${PAGE}`
        : `SELECT id, session_id, variation_index AS idx FROM generated_images
           WHERE image_key IS NULL AND image_data LIKE 'data:%' AND id > ? ORDER BY id LIMIT ${PAGE}`,
      [lastId]
    );
    if (!page.length) break;
    lastId = page[page.length - 1].id;

    for (let i = 0; i < page.length; i += CONCURRENCY) {
      await Promise.all(page.slice(i, i + CONCURRENCY).map(async row => {
        if (done + failed >= LIMIT || skip.has(row.id)) return;
        try {
          const [full] = await d1<{ image_data: string }>(`SELECT image_data FROM ${TABLE} WHERE id = ?`, [row.id]);
          const parsed = parseDataUrl(full?.image_data);
          if (!parsed) throw new Error('not a base64 data URL');
          const key = LEDGER
            ? `ledger/${row.id}.${extFor(parsed.contentType)}`
            : `generated/${row.session_id}/${row.idx}-migrated-${row.id}.${extFor(parsed.contentType)}`;
          await r2Put(key, parsed.bytes, parsed.contentType);
          // Only record the key once the object is safely in R2.
          await d1(`UPDATE ${TABLE} SET image_key = ? WHERE id = ? AND image_key IS NULL`, [key, row.id]);
          done++;
        } catch (e: any) {
          failed++;
          skip.add(row.id);
          console.error(`  row ${row.id}: ${e?.message || e}`);
        }
      }));
      console.log(`  moved ${done}, failed ${failed}`);
    }
  }
  console.log(`Done: ${done} moved, ${failed} failed. Re-run to retry failures.`);
}

(async () => {
  if (CLEAR) await clearMigrated();
  else await migrate();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
