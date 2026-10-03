import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Bottle {
  message: string;
}

const EMPTY_OCEAN_MESSAGE = "The ocean is quiet. No bottles to catch yet.";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bottles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      caught_at TEXT
    )
  `);
  return db;
}

// Existence only: whether any uncaught bottle is out there, never how many.
export function oceanIsEmpty(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT EXISTS(SELECT 1 FROM bottles WHERE caught_at IS NULL) AS present")
    .get() as { present: number };
  return row.present === 0;
}

export function throwBottle(db: DatabaseSync, message: string): void {
  db.prepare("INSERT INTO bottles (message) VALUES (?)").run(message);
}

// One atomic statement: the row to update is chosen and claimed in the same
// UPDATE, so there's no window between reading which bottle is uncaught and
// marking it caught for another concurrent catch to land in. Combined with
// node:sqlite's synchronous, non-yielding call, this is a single uninterruptible
// unit from Node's event loop's point of view.
export function catchBottle(db: DatabaseSync): { bottle: Bottle | null; message?: string } {
  const row = db
    .prepare(
      `UPDATE bottles
       SET caught_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = (SELECT id FROM bottles WHERE caught_at IS NULL ORDER BY RANDOM() LIMIT 1)
       RETURNING message`,
    )
    .get() as { message: string } | undefined;

  if (!row) {
    return { bottle: null, message: EMPTY_OCEAN_MESSAGE };
  }
  return { bottle: { message: row.message } };
}
