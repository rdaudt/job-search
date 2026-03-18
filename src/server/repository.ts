import Database from "better-sqlite3";
import { stringify } from "csv-stringify/sync";
import type {
  CapturePayload,
  JobCsvRow,
  JobRecord,
  JobStatus,
  PersistedSearchProfile,
  RunRecord,
  SearchProfile
} from "../shared/types.js";
import type { SourceAdapter } from "../shared/types.js";

type JobRow = {
  id: number;
  source: string;
  source_job_id: string | null;
  dedupe_key: string;
  normalized_url: string;
  title: string;
  company: string;
  location: string;
  summary: string | null;
  first_captured_at: string;
  last_seen_at: string;
  status: JobStatus;
  matching_search_profiles: string;
};

type RunRow = {
  id: number;
  started_at: string;
  search_count: number;
};

type SearchRow = {
  id: string;
  name: string;
  keywords: string;
  location: string;
  remote: number;
  created_at: string;
  updated_at: string;
};

export class Repository {
  constructor(
    private readonly database: Database.Database,
    private readonly adapter: SourceAdapter,
  ) {}

  replaceSearchProfiles(searchProfiles: SearchProfile[]): void {
    const now = new Date().toISOString();
    const transaction = this.database.transaction((profiles: SearchProfile[]) => {
      this.database.prepare("DELETE FROM job_search_matches").run();
      this.database.prepare("DELETE FROM jobs").run();
      this.database.prepare("DELETE FROM runs").run();
      this.database.prepare("DELETE FROM search_profiles").run();
      const insert = this.database.prepare(`
        INSERT INTO search_profiles (id, name, keywords, location, remote, created_at, updated_at)
        VALUES (@id, @name, @keywords, @location, @remote, @createdAt, @updatedAt)
      `);

      for (const profile of profiles) {
        insert.run({
          id: profile.id,
          name: profile.name,
          keywords: profile.keywords,
          location: profile.location,
          remote: profile.remote ? 1 : 0,
          createdAt: now,
          updatedAt: now
        });
      }
    });

    transaction(searchProfiles);
  }

  listSearchProfiles(): PersistedSearchProfile[] {
    const rows = this.database
      .prepare("SELECT * FROM search_profiles ORDER BY name ASC")
      .all() as SearchRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      keywords: row.keywords,
      location: row.location,
      remote: Boolean(row.remote),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  createRun(searchCount: number): RunRecord {
    const startedAt = new Date().toISOString();
    const result = this.database
      .prepare("INSERT INTO runs (started_at, search_count) VALUES (?, ?)")
      .run(startedAt, searchCount);
    return {
      id: Number(result.lastInsertRowid),
      startedAt,
      searchCount
    };
  }

  listRuns(): RunRecord[] {
    const rows = this.database
      .prepare("SELECT id, started_at, search_count FROM runs ORDER BY started_at DESC LIMIT 20")
      .all() as RunRow[];

    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      searchCount: row.search_count
    }));
  }

  ingestCapture(payload: CapturePayload): { inserted: number; updated: number } {
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;

    const transaction = this.database.transaction(() => {
      const findJob = this.database.prepare("SELECT id FROM jobs WHERE dedupe_key = ?");
      const insertJob = this.database.prepare(`
        INSERT INTO jobs (
          source, source_job_id, dedupe_key, normalized_url, title, company, location, summary,
          first_captured_at, last_seen_at, status
        )
        VALUES (
          @source, @sourceJobId, @dedupeKey, @normalizedUrl, @title, @company, @location, @summary,
          @capturedAt, @capturedAt, 'new'
        )
      `);
      const updateJob = this.database.prepare(`
        UPDATE jobs
        SET
          source_job_id = COALESCE(@sourceJobId, source_job_id),
          normalized_url = @normalizedUrl,
          title = @title,
          company = @company,
          location = @location,
          summary = @summary,
          last_seen_at = @capturedAt
        WHERE id = @id
      `);
      const findMatch = this.database.prepare(`
        SELECT 1 FROM job_search_matches WHERE job_id = ? AND search_profile_id = ?
      `);
      const insertMatch = this.database.prepare(`
        INSERT INTO job_search_matches (job_id, search_profile_id, first_captured_at, last_seen_at)
        VALUES (?, ?, ?, ?)
      `);
      const updateMatch = this.database.prepare(`
        UPDATE job_search_matches
        SET last_seen_at = ?
        WHERE job_id = ? AND search_profile_id = ?
      `);

      for (const listing of payload.listings) {
        const mapped = this.adapter.mapCaptureToJobRecord(listing);
        const existing = findJob.get(mapped.dedupeKey) as { id: number } | undefined;
        let jobId: number;
        if (existing) {
          updateJob.run({ ...mapped, capturedAt: now, id: existing.id });
          updated += 1;
          jobId = existing.id;
        } else {
          const result = insertJob.run({ ...mapped, capturedAt: now });
          jobId = Number(result.lastInsertRowid);
          inserted += 1;
        }

        const matchExists = findMatch.get(jobId, payload.searchProfileId);
        if (matchExists) {
          updateMatch.run(now, jobId, payload.searchProfileId);
        } else {
          insertMatch.run(jobId, payload.searchProfileId, now, now);
        }
      }
    });

    transaction();
    return { inserted, updated };
  }

  listJobs(): JobRecord[] {
    const rows = this.database
      .prepare(`
        SELECT
          jobs.id,
          jobs.source,
          jobs.source_job_id,
          jobs.dedupe_key,
          jobs.normalized_url,
          jobs.title,
          jobs.company,
          jobs.location,
          jobs.summary,
          jobs.first_captured_at,
          jobs.last_seen_at,
          jobs.status,
          GROUP_CONCAT(search_profiles.name, '; ') AS matching_search_profiles
        FROM jobs
        LEFT JOIN job_search_matches ON job_search_matches.job_id = jobs.id
        LEFT JOIN search_profiles ON search_profiles.id = job_search_matches.search_profile_id
        GROUP BY jobs.id
        ORDER BY jobs.last_seen_at DESC
      `)
      .all() as JobRow[];

    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      sourceJobId: row.source_job_id,
      dedupeKey: row.dedupe_key,
      normalizedUrl: row.normalized_url,
      title: row.title,
      company: row.company,
      location: row.location,
      summary: row.summary,
      firstCapturedAt: row.first_captured_at,
      lastSeenAt: row.last_seen_at,
      status: row.status,
      matchingSearchProfiles: row.matching_search_profiles
        ? row.matching_search_profiles.split("; ").filter(Boolean)
        : []
    }));
  }

  updateJobStatus(jobId: number, status: JobStatus): void {
    this.database.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, jobId);
  }

  exportJobsCsv(): string {
    const rows: JobCsvRow[] = this.listJobs().map((job) => ({
      title: job.title,
      company: job.company,
      location: job.location,
      source: job.source,
      sourceUrl: job.normalizedUrl,
      searchProfiles: job.matchingSearchProfiles.join("; "),
      firstCapturedAt: job.firstCapturedAt,
      lastSeenAt: job.lastSeenAt,
      status: job.status
    }));

    return stringify(rows, {
      header: true,
      columns: [
        "title",
        "company",
        "location",
        "source",
        "sourceUrl",
        "searchProfiles",
        "firstCapturedAt",
        "lastSeenAt",
        "status"
      ]
    });
  }

  close(): void {
    this.database.close();
  }
}
