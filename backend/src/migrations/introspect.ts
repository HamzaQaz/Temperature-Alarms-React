import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

/** Every base table in the connected database, sorted by name. */
export async function baseTables(conn: PoolConnection): Promise<string[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return rows.map((r) => r.name as string);
}

export async function tableExists(conn: PoolConnection, table: string): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  );
  return rows.length > 0;
}

export async function columnExists(conn: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column],
  );
  return rows.length > 0;
}
