import Database from "better-sqlite3";
import { stringify } from "csv-stringify/sync";
import type {
  CapturePayload,
  JobCsvRow,
  JobRecord,
  JobStatus,
  PersistedSearchProfile,
  RunMode,
  RunTarget,
  RunRecord,
  RunTargetStateUpdate,
  SearchProfile
} from "../shared/types.js";
import type { SourceAdapter } from "../shared/types.js";
import { listingMatchesCanadianScope, listingMatchesRunLocation } from "../shared/location-utils.js";

type JobRow = {
  id: number;
  source: string;
  source_job_id: string | null;
  dedupe_key: string;
  normalized_url: string;
  is_linkable: number;
  title: string;
  company: string;
  location: string;
  summary: string | null;
  first_captured_at: string;
  last_seen_at: string;
  status: JobStatus;
  matching_search_profiles: string;
  matching_run_locations: string;
};

type RunRow = {
  id: number;
  started_at: string;
  search_count: number;
  run_mode: RunMode;
  max_pages: number;
  zero_new_jobs_threshold: number;
  emergency_max_pages: number;
  search_launch_delay_ms: number;
  search_launch_jitter_ms: number;
  page_delay_ms: number;
  page_delay_jitter_ms: number;
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

type RunTargetRow = {
  id: string;
  run_id: number;
  search_profile_id: string;
  search_profile_name: string;
  keywords: string;
  remote: number;
  location: string;
  run_mode: RunMode;
  max_pages: number;
  zero_new_jobs_threshold: number;
  emergency_max_pages: number;
  search_launch_delay_ms: number;
  search_launch_jitter_ms: number;
  page_delay_ms: number;
  page_delay_jitter_ms: number;
  pages_captured: number;
  status: string;
  stop_reason: string | null;
  last_page_number: number | null;
  last_page_url: string | null;
  updated_at: string;
};

type RunTargetTemplate = Pick<
  RunTarget,
  "id" | "searchProfileId" | "searchProfileName" | "keywords" | "remote" | "location"
>;
type RunConfig = {
  runMode: RunMode;
  maxPages: number;
  zeroNewJobsThreshold: number;
  emergencyMaxPages: number;
  searchLaunchDelayMs: number;
  searchLaunchJitterMs: number;
  pageDelayMs: number;
  pageDelayJitterMs: number;
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
      this.database.prepare("DELETE FROM run_targets").run();
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

  createRun(runTargetTemplates: RunTargetTemplate[], config: RunConfig): { run: RunRecord; targets: RunTarget[] } {
    const startedAt = new Date().toISOString();
    const transaction = this.database.transaction((templates: RunTargetTemplate[], runConfig: RunConfig) => {
      const runResult = this.database
        .prepare(`
          INSERT INTO runs (
            started_at, search_count, run_mode, max_pages, zero_new_jobs_threshold, emergency_max_pages,
            search_launch_delay_ms, search_launch_jitter_ms, page_delay_ms, page_delay_jitter_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          startedAt,
          templates.length,
          runConfig.runMode,
          runConfig.maxPages,
          runConfig.zeroNewJobsThreshold,
          runConfig.emergencyMaxPages,
          runConfig.searchLaunchDelayMs,
          runConfig.searchLaunchJitterMs,
          runConfig.pageDelayMs,
          runConfig.pageDelayJitterMs,
        );
      const runId = Number(runResult.lastInsertRowid);
      const insertRunTarget = this.database.prepare(`
        INSERT INTO run_targets (
          id, run_id, search_profile_id, location, run_mode, max_pages, zero_new_jobs_threshold,
          emergency_max_pages, search_launch_delay_ms, search_launch_jitter_ms, page_delay_ms, page_delay_jitter_ms,
          pages_captured, status, stop_reason, last_page_number, last_page_url, updated_at
        )
        VALUES (
          @id, @runId, @searchProfileId, @location, @runMode, @maxPages, @zeroNewJobsThreshold,
          @emergencyMaxPages, @searchLaunchDelayMs, @searchLaunchJitterMs, @pageDelayMs, @pageDelayJitterMs,
          0, 'pending', NULL, NULL, NULL, @updatedAt
        )
      `);

      for (const template of templates) {
        insertRunTarget.run({
          id: template.id,
          runId,
          searchProfileId: template.searchProfileId,
          location: template.location,
          runMode: runConfig.runMode,
          maxPages: runConfig.maxPages,
          zeroNewJobsThreshold: runConfig.zeroNewJobsThreshold,
          emergencyMaxPages: runConfig.emergencyMaxPages,
          searchLaunchDelayMs: runConfig.searchLaunchDelayMs,
          searchLaunchJitterMs: runConfig.searchLaunchJitterMs,
          pageDelayMs: runConfig.pageDelayMs,
          pageDelayJitterMs: runConfig.pageDelayJitterMs,
          updatedAt: startedAt
        });
      }

      return {
        run: {
          id: runId,
          startedAt,
          searchCount: templates.length,
          runMode: runConfig.runMode,
          maxPages: runConfig.maxPages,
          zeroNewJobsThreshold: runConfig.zeroNewJobsThreshold,
          emergencyMaxPages: runConfig.emergencyMaxPages,
          searchLaunchDelayMs: runConfig.searchLaunchDelayMs,
          searchLaunchJitterMs: runConfig.searchLaunchJitterMs,
          pageDelayMs: runConfig.pageDelayMs,
          pageDelayJitterMs: runConfig.pageDelayJitterMs
        },
        targets: templates.map((template) => ({
          ...template,
          runId,
          runMode: runConfig.runMode,
          maxPages: runConfig.maxPages,
          zeroNewJobsThreshold: runConfig.zeroNewJobsThreshold,
          emergencyMaxPages: runConfig.emergencyMaxPages,
          searchLaunchDelayMs: runConfig.searchLaunchDelayMs,
          searchLaunchJitterMs: runConfig.searchLaunchJitterMs,
          pageDelayMs: runConfig.pageDelayMs,
          pageDelayJitterMs: runConfig.pageDelayJitterMs,
          pagesCaptured: 0,
          status: "pending",
          stopReason: null,
          lastPageNumber: null,
          lastPageUrl: null,
          updatedAt: startedAt
        }))
      };
    });

    return transaction(runTargetTemplates, config);
  }

  listRuns(): RunRecord[] {
    const rows = this.database
      .prepare(`
        SELECT
          id,
          started_at,
          search_count,
          run_mode,
          max_pages,
          zero_new_jobs_threshold,
          emergency_max_pages,
          search_launch_delay_ms,
          search_launch_jitter_ms,
          page_delay_ms,
          page_delay_jitter_ms
        FROM runs
        ORDER BY started_at DESC LIMIT 20
      `)
      .all() as RunRow[];

    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      searchCount: row.search_count,
      runMode: row.run_mode,
      maxPages: row.max_pages,
      zeroNewJobsThreshold: row.zero_new_jobs_threshold,
      emergencyMaxPages: row.emergency_max_pages,
      searchLaunchDelayMs: row.search_launch_delay_ms,
      searchLaunchJitterMs: row.search_launch_jitter_ms,
      pageDelayMs: row.page_delay_ms,
      pageDelayJitterMs: row.page_delay_jitter_ms
    }));
  }

  listLatestRunTargets(): RunTarget[] {
    const latestRun = this.database.prepare("SELECT MAX(id) AS id FROM runs").get() as { id: number | null };
    if (!latestRun.id) {
      return [];
    }

    const rows = this.database
      .prepare(`
        SELECT
          run_targets.id,
          run_targets.run_id,
          run_targets.search_profile_id,
          search_profiles.name AS search_profile_name,
          search_profiles.keywords,
          search_profiles.remote,
          run_targets.location,
          run_targets.run_mode,
          run_targets.max_pages,
          run_targets.zero_new_jobs_threshold,
          run_targets.emergency_max_pages,
          run_targets.search_launch_delay_ms,
          run_targets.search_launch_jitter_ms,
          run_targets.page_delay_ms,
          run_targets.page_delay_jitter_ms,
          run_targets.pages_captured,
          run_targets.status,
          run_targets.stop_reason,
          run_targets.last_page_number,
          run_targets.last_page_url,
          run_targets.updated_at
        FROM run_targets
        INNER JOIN search_profiles ON search_profiles.id = run_targets.search_profile_id
        WHERE run_targets.run_id = ?
        ORDER BY search_profiles.name ASC, run_targets.location ASC, run_targets.id ASC
      `)
      .all(latestRun.id) as RunTargetRow[];

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      searchProfileId: row.search_profile_id,
      searchProfileName: row.search_profile_name,
      keywords: row.keywords,
      remote: Boolean(row.remote),
      location: row.location,
      runMode: row.run_mode,
      maxPages: row.max_pages,
      zeroNewJobsThreshold: row.zero_new_jobs_threshold,
      emergencyMaxPages: row.emergency_max_pages,
      searchLaunchDelayMs: row.search_launch_delay_ms,
      searchLaunchJitterMs: row.search_launch_jitter_ms,
      pageDelayMs: row.page_delay_ms,
      pageDelayJitterMs: row.page_delay_jitter_ms,
      pagesCaptured: row.pages_captured,
      status: row.status as RunTarget["status"],
      stopReason: row.stop_reason,
      lastPageNumber: row.last_page_number,
      lastPageUrl: row.last_page_url,
      updatedAt: row.updated_at
    }));
  }

  getRunTarget(runTargetId: string): RunTarget | null {
    const row = this.database
      .prepare(`
        SELECT
          run_targets.id,
          run_targets.run_id,
          run_targets.search_profile_id,
          search_profiles.name AS search_profile_name,
          search_profiles.keywords,
          search_profiles.remote,
          run_targets.location,
          run_targets.run_mode,
          run_targets.max_pages,
          run_targets.zero_new_jobs_threshold,
          run_targets.emergency_max_pages,
          run_targets.search_launch_delay_ms,
          run_targets.search_launch_jitter_ms,
          run_targets.page_delay_ms,
          run_targets.page_delay_jitter_ms,
          run_targets.pages_captured,
          run_targets.status,
          run_targets.stop_reason,
          run_targets.last_page_number,
          run_targets.last_page_url,
          run_targets.updated_at
        FROM run_targets
        INNER JOIN search_profiles ON search_profiles.id = run_targets.search_profile_id
        WHERE run_targets.id = ?
      `)
      .get(runTargetId) as RunTargetRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      runId: row.run_id,
      searchProfileId: row.search_profile_id,
      searchProfileName: row.search_profile_name,
      keywords: row.keywords,
      remote: Boolean(row.remote),
      location: row.location,
      runMode: row.run_mode,
      maxPages: row.max_pages,
      zeroNewJobsThreshold: row.zero_new_jobs_threshold,
      emergencyMaxPages: row.emergency_max_pages,
      searchLaunchDelayMs: row.search_launch_delay_ms,
      searchLaunchJitterMs: row.search_launch_jitter_ms,
      pageDelayMs: row.page_delay_ms,
      pageDelayJitterMs: row.page_delay_jitter_ms,
      pagesCaptured: row.pages_captured,
      status: row.status as RunTarget["status"],
      stopReason: row.stop_reason,
      lastPageNumber: row.last_page_number,
      lastPageUrl: row.last_page_url,
      updatedAt: row.updated_at
    };
  }

  updateRunTargetState(runTargetId: string, update: RunTargetStateUpdate): void {
    const now = new Date().toISOString();
    const clearStopReason = update.status === "capturing" || update.status === "pending" ? 1 : 0;
    this.database
      .prepare(`
        UPDATE run_targets
        SET
          status = @status,
          stop_reason = CASE
            WHEN @clearStopReason = 1 THEN NULL
            WHEN @stopReason IS NOT NULL THEN @stopReason
            ELSE stop_reason
          END,
          pages_captured = CASE
            WHEN @pageNumber IS NOT NULL AND @pageNumber > pages_captured THEN @pageNumber
            ELSE pages_captured
          END,
          last_page_number = COALESCE(@pageNumber, last_page_number),
          last_page_url = COALESCE(@pageUrl, last_page_url),
          updated_at = @updatedAt
        WHERE id = @runTargetId
      `)
      .run({
        runTargetId,
        status: update.status,
        stopReason: update.stopReason ?? null,
        pageNumber: update.pageNumber ?? null,
        pageUrl: update.pageUrl ?? null,
        updatedAt: now,
        clearStopReason
      });
  }

  ingestCapture(payload: CapturePayload): { inserted: number; updated: number } {
    const now = new Date().toISOString();
    const pageNumber = payload.pageNumber ?? 1;
    let inserted = 0;
    let updated = 0;
    const runTarget = this.getRunTarget(payload.runTargetId);
    if (!runTarget) {
      throw new Error(`Unknown run target '${payload.runTargetId}'.`);
    }

    const transaction = this.database.transaction(() => {
      const findJob = this.database.prepare("SELECT id FROM jobs WHERE dedupe_key = ?");
      const insertJob = this.database.prepare(`
        INSERT INTO jobs (
          source, source_job_id, dedupe_key, normalized_url, is_linkable, title, company, location, summary,
          first_captured_at, last_seen_at, status
        )
        VALUES (
          @source, @sourceJobId, @dedupeKey, @normalizedUrl, @isLinkable, @title, @company, @location, @summary,
          @capturedAt, @capturedAt, 'new'
        )
      `);
      const updateJob = this.database.prepare(`
        UPDATE jobs
        SET
          source_job_id = COALESCE(@sourceJobId, source_job_id),
          normalized_url = @normalizedUrl,
          is_linkable = @isLinkable,
          title = @title,
          company = @company,
          location = @location,
          summary = @summary,
          last_seen_at = @capturedAt
        WHERE id = @id
      `);
      const findMatch = this.database.prepare(`
        SELECT 1 FROM job_search_matches WHERE job_id = ? AND run_target_id = ?
      `);
      const insertMatch = this.database.prepare(`
        INSERT INTO job_search_matches (job_id, run_target_id, first_captured_at, last_seen_at)
        VALUES (?, ?, ?, ?)
      `);
      const updateMatch = this.database.prepare(`
        UPDATE job_search_matches
        SET last_seen_at = ?
        WHERE job_id = ? AND run_target_id = ?
      `);
      const updateRunTargetProgress = this.database.prepare(`
        UPDATE run_targets
        SET
          pages_captured = CASE
            WHEN pages_captured > @pageNumber THEN pages_captured
            ELSE @pageNumber
          END,
          status = 'capturing',
          stop_reason = NULL,
          last_page_number = @pageNumber,
          last_page_url = @pageUrl,
          updated_at = @updatedAt
        WHERE id = @runTargetId
      `);

      updateRunTargetProgress.run({
        pageNumber,
        pageUrl: payload.pageUrl,
        updatedAt: now,
        runTargetId: payload.runTargetId
      });

      for (const listing of payload.listings) {
        if (!listingMatchesCanadianScope(listing.location, runTarget.remote)) {
          continue;
        }
        if (!listingMatchesRunLocation(listing.location, runTarget.location, runTarget.remote)) {
          continue;
        }
        const mapped = this.adapter.mapCaptureToJobRecord(listing);
        const persistedMapped = {
          ...mapped,
          isLinkable: mapped.isLinkable ? 1 : 0
        };
        const existing = findJob.get(mapped.dedupeKey) as { id: number } | undefined;
        let jobId: number;
        if (existing) {
          updateJob.run({ ...persistedMapped, capturedAt: now, id: existing.id });
          updated += 1;
          jobId = existing.id;
        } else {
          const result = insertJob.run({ ...persistedMapped, capturedAt: now });
          jobId = Number(result.lastInsertRowid);
          inserted += 1;
        }

        const matchExists = findMatch.get(jobId, payload.runTargetId);
        if (matchExists) {
          updateMatch.run(now, jobId, payload.runTargetId);
        } else {
          insertMatch.run(jobId, payload.runTargetId, now, now);
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
          jobs.is_linkable,
          jobs.title,
          jobs.company,
          jobs.location,
          jobs.summary,
          jobs.first_captured_at,
          jobs.last_seen_at,
          jobs.status,
          GROUP_CONCAT(search_profiles.name, '||') AS matching_search_profiles,
          GROUP_CONCAT(run_targets.location, '||') AS matching_run_locations
        FROM jobs
        LEFT JOIN job_search_matches ON job_search_matches.job_id = jobs.id
        LEFT JOIN run_targets ON run_targets.id = job_search_matches.run_target_id
        LEFT JOIN search_profiles ON search_profiles.id = run_targets.search_profile_id
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
      isLinkable: Boolean(row.is_linkable),
      title: row.title,
      company: row.company,
      location: row.location,
      summary: row.summary,
      firstCapturedAt: row.first_captured_at,
      lastSeenAt: row.last_seen_at,
      status: row.status,
      matchingSearchProfiles: row.matching_search_profiles
        ? [...new Set(row.matching_search_profiles.split("||").filter(Boolean))].sort((a, b) =>
            a.localeCompare(b),
          )
        : [],
      matchingRunLocations: row.matching_run_locations
        ? [...new Set(row.matching_run_locations.split("||").filter(Boolean))].sort((a, b) =>
            a.localeCompare(b),
          )
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
      runLocations: job.matchingRunLocations.join("; "),
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
        "runLocations",
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
