import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return Boolean(row);
}

function tableHasColumn(database: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(database, tableName)) {
    return false;
  }

  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function migrateRunTrackingSchema(database: Database.Database): void {
  if (tableHasColumn(database, "job_search_matches", "run_target_id")) {
    return;
  }

  database.exec(`
    DROP TABLE IF EXISTS job_search_matches;
    DROP TABLE IF EXISTS run_targets;
    DROP TABLE IF EXISTS jobs;
    DROP TABLE IF EXISTS runs;
  `);
}

function ensureLinkabilityColumn(database: Database.Database): void {
  if (!tableHasColumn(database, "jobs", "is_linkable")) {
    database.exec("ALTER TABLE jobs ADD COLUMN is_linkable INTEGER NOT NULL DEFAULT 1");
  }
}

function ensureRunColumns(database: Database.Database): void {
  if (!tableHasColumn(database, "runs", "max_pages")) {
    database.exec("ALTER TABLE runs ADD COLUMN max_pages INTEGER NOT NULL DEFAULT 1");
  }
}

function ensureRunTargetColumns(database: Database.Database): void {
  if (!tableHasColumn(database, "run_targets", "max_pages")) {
    database.exec("ALTER TABLE run_targets ADD COLUMN max_pages INTEGER NOT NULL DEFAULT 1");
  }
  if (!tableHasColumn(database, "run_targets", "pages_captured")) {
    database.exec("ALTER TABLE run_targets ADD COLUMN pages_captured INTEGER NOT NULL DEFAULT 0");
  }
  if (!tableHasColumn(database, "run_targets", "status")) {
    database.exec("ALTER TABLE run_targets ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!tableHasColumn(database, "run_targets", "stop_reason")) {
    database.exec("ALTER TABLE run_targets ADD COLUMN stop_reason TEXT");
  }
  if (!tableHasColumn(database, "run_targets", "last_page_number")) {
    database.exec("ALTER TABLE run_targets ADD COLUMN last_page_number INTEGER");
  }
  if (!tableHasColumn(database, "run_targets", "last_page_url")) {
    database.exec("ALTER TABLE run_targets ADD COLUMN last_page_url TEXT");
  }
  if (!tableHasColumn(database, "run_targets", "updated_at")) {
    database.exec("ALTER TABLE run_targets ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  }
}

export function ensureDataDir(rootDir: string): string {
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function createDatabase(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS search_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      keywords TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      remote INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

  `);
  migrateRunTrackingSchema(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      search_count INTEGER NOT NULL,
      max_pages INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS run_targets (
      id TEXT PRIMARY KEY,
      run_id INTEGER NOT NULL,
      search_profile_id TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      max_pages INTEGER NOT NULL DEFAULT 1,
      pages_captured INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      stop_reason TEXT,
      last_page_number INTEGER,
      last_page_url TEXT,
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (search_profile_id) REFERENCES search_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_job_id TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      normalized_url TEXT NOT NULL,
      is_linkable INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      summary TEXT,
      first_captured_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new'
    );

    CREATE TABLE IF NOT EXISTS job_search_matches (
      job_id INTEGER NOT NULL,
      run_target_id TEXT NOT NULL,
      first_captured_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (job_id, run_target_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (run_target_id) REFERENCES run_targets(id) ON DELETE CASCADE
    );
  `);
  ensureLinkabilityColumn(database);
  ensureRunColumns(database);
  ensureRunTargetColumns(database);
  return database;
}
