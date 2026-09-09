import postgres from 'postgres';

/**
 * Creates the target database when it does not exist yet, so a fresh machine
 * only needs a running PostgreSQL server and a DATABASE_URL. Uses the
 * maintenance database `postgres` on the same server with the same credentials.
 */
export async function ensureDatabase(url: string): Promise<'exists' | 'created'> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!dbName) throw new Error('DATABASE_URL must include a database name');

  const probe = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await probe`select 1`;
    return 'exists';
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== '3D000') throw err; // anything but "database does not exist"
  } finally {
    await probe.end({ timeout: 2 });
  }

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`create database "${dbName.replace(/"/g, '""')}"`);
    return 'created';
  } finally {
    await admin.end({ timeout: 2 });
  }
}
