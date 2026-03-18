import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      search_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_job_id TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      normalized_url TEXT NOT NULL,
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
      search_profile_id TEXT NOT NULL,
      first_captured_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (job_id, search_profile_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (search_profile_id) REFERENCES search_profiles(id) ON DELETE CASCADE
    );
  `);
  return database;
}
