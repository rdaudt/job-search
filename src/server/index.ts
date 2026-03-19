import path from "node:path";
import cors from "cors";
import express from "express";
import multer from "multer";
import { indeedAdapter } from "../shared/indeed.js";
import {
  capturePayloadSchema,
  DEFAULT_AUTO_ZERO_NEW_JOBS_THRESHOLD,
  DEFAULT_EMERGENCY_MAX_PAGES,
  DEFAULT_FIXED_MAX_PAGES,
  runRequestSchema,
  runTargetStateUpdateSchema,
  statusValues,
  type AppSummary,
  type JobStatus,
  type RunMode,
  type RunRetentionMode
} from "../shared/types.js";
import { openSearchUrls } from "./browser.js";
import { createDatabase, ensureDataDir } from "./db.js";
import { parseSearchProfilesFile } from "./importers.js";
import { Repository } from "./repository.js";
import { buildRunTargetTemplates, normalizeRunLocations } from "./run-targets.js";

const rootDir = process.cwd();
const distRoot = path.join(rootDir, "dist");
const publicDir = path.join(distRoot, "public");
const dataDir = ensureDataDir(rootDir);
const database = createDatabase(path.join(dataDir, "job-search.sqlite"));
const repository = new Repository(database, indeedAdapter);

const app = express();
const upload = multer();
const port = Number(process.env.PORT ?? 4312);
const MAX_FIXED_PAGES_LIMIT = 10;
const MAX_ZERO_NEW_JOBS_THRESHOLD = 5;
const MIN_ZERO_NEW_JOBS_THRESHOLD = 1;
const EMERGENCY_MAX_PAGES = DEFAULT_EMERGENCY_MAX_PAGES;
const MAX_DELAY_MS = 120_000;

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function getSummary(): AppSummary {
  return {
    searches: repository.listSearchProfiles(),
    jobs: repository.listJobs(),
    runs: repository.listRuns(),
    latestRunTargets: repository.listLatestRunTargets()
  };
}

function normalizeRunConfig(rawBody: unknown): {
  retentionMode: RunRetentionMode;
  mode: RunMode;
  maxPages: number;
  zeroNewJobsThreshold: number;
  emergencyMaxPages: number;
  searchLaunchDelayMs: number;
  searchLaunchJitterMs: number;
  pageDelayMs: number;
  pageDelayJitterMs: number;
} {
  const parsed = runRequestSchema.parse(rawBody ?? {});
  const retentionMode = parsed.retentionMode;
  const mode = parsed.mode;
  const maxPages = Math.min(Math.max(parsed.maxPages, 1), MAX_FIXED_PAGES_LIMIT);
  const zeroNewJobsThreshold = Math.min(
    Math.max(parsed.zeroNewJobsThreshold, MIN_ZERO_NEW_JOBS_THRESHOLD),
    MAX_ZERO_NEW_JOBS_THRESHOLD,
  );
  const searchLaunchDelayMs = Math.min(Math.max(parsed.searchLaunchDelayMs, 0), MAX_DELAY_MS);
  const searchLaunchJitterMs = Math.min(Math.max(parsed.searchLaunchJitterMs, 0), MAX_DELAY_MS);
  const pageDelayMs = Math.min(Math.max(parsed.pageDelayMs, 0), MAX_DELAY_MS);
  const pageDelayJitterMs = Math.min(Math.max(parsed.pageDelayJitterMs, 0), MAX_DELAY_MS);

  if (mode === "auto") {
    return {
      mode,
      retentionMode,
      maxPages: DEFAULT_FIXED_MAX_PAGES,
      zeroNewJobsThreshold,
      emergencyMaxPages: EMERGENCY_MAX_PAGES,
      searchLaunchDelayMs,
      searchLaunchJitterMs,
      pageDelayMs,
      pageDelayJitterMs
    };
  }

  return {
    mode,
    retentionMode,
    maxPages,
    zeroNewJobsThreshold: DEFAULT_AUTO_ZERO_NEW_JOBS_THRESHOLD,
    emergencyMaxPages: EMERGENCY_MAX_PAGES,
    searchLaunchDelayMs,
    searchLaunchJitterMs,
    pageDelayMs,
    pageDelayJitterMs
  };
}

app.get("/api/summary", (_req, res) => {
  res.json(getSummary());
});

app.post("/api/searches/import", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Upload a JSON or CSV file." });
      return;
    }

    const content = req.file.buffer.toString("utf-8");
    const profiles = parseSearchProfilesFile(req.file.originalname, content);
    repository.replaceSearchProfiles(profiles);
    res.json({ imported: profiles.length, searches: repository.listSearchProfiles() });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not import search profiles."
    });
  }
});

app.post("/api/runs", async (req, res) => {
  try {
    const searches = repository.listSearchProfiles();
    if (!searches.length) {
      res.status(400).json({ error: "Import at least one search profile before running searches." });
      return;
    }

    const requestedLocations = normalizeRunLocations(Array.isArray(req.body?.locations) ? req.body.locations : []);
    const runTargetTemplates = buildRunTargetTemplates(searches, requestedLocations);
    const runConfig = normalizeRunConfig(req.body);
    if (runConfig.retentionMode === "reset") {
      repository.resetCapturedData();
    }
    const { run, targets } = repository.createRun(runTargetTemplates, {
      retentionMode: runConfig.retentionMode,
      runMode: runConfig.mode,
      maxPages: runConfig.maxPages,
      zeroNewJobsThreshold: runConfig.zeroNewJobsThreshold,
      emergencyMaxPages: runConfig.emergencyMaxPages,
      searchLaunchDelayMs: runConfig.searchLaunchDelayMs,
      searchLaunchJitterMs: runConfig.searchLaunchJitterMs,
      pageDelayMs: runConfig.pageDelayMs,
      pageDelayJitterMs: runConfig.pageDelayJitterMs
    });
    const urls = targets.map((target) => indeedAdapter.buildSearchUrl(target));
    void openSearchUrls(urls, {
      searchLaunchDelayMs: runConfig.searchLaunchDelayMs,
      searchLaunchJitterMs: runConfig.searchLaunchJitterMs
    });
    res.json({ run, urls, targets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to launch search URLs.";
    const statusCode =
      message.includes("Canadian location") || message.includes("Import at least one search profile")
        ? 400
        : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.post("/api/captures", (req, res) => {
  try {
    const payload = capturePayloadSchema.parse(req.body);
    const knownRunTarget = repository.getRunTarget(payload.runTargetId);
    if (!knownRunTarget) {
      res.status(400).json({ error: `Unknown run target '${payload.runTargetId}'.` });
      return;
    }

    const result = repository.ingestCapture(payload);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not ingest capture payload."
    });
  }
});

app.post("/api/run-targets/:id/state", (req, res) => {
  try {
    const runTargetId = req.params.id;
    const knownRunTarget = repository.getRunTarget(runTargetId);
    if (!knownRunTarget) {
      res.status(404).json({ error: `Unknown run target '${runTargetId}'.` });
      return;
    }

    const update = runTargetStateUpdateSchema.parse(req.body);
    repository.updateRunTargetState(runTargetId, update);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not update run target state."
    });
  }
});

app.patch("/api/jobs/:id/status", (req, res) => {
  const jobId = Number(req.params.id);
  const status = req.body?.status as JobStatus | undefined;

  if (!Number.isInteger(jobId) || !status || !statusValues.includes(status)) {
    res.status(400).json({ error: "Provide a valid job id and status." });
    return;
  }

  repository.updateJobStatus(jobId, status);
  res.json({ ok: true });
});

app.get("/api/jobs/export.csv", (_req, res) => {
  const csv = repository.exportJobsCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"jobs.csv\"");
  res.send(csv);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Job Search Finder listening on http://127.0.0.1:${port}`);
});
