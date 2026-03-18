import path from "node:path";
import cors from "cors";
import express from "express";
import multer from "multer";
import { indeedAdapter } from "../shared/indeed.js";
import {
  capturePayloadSchema,
  statusValues,
  type AppSummary,
  type JobStatus
} from "../shared/types.js";
import { openSearchUrls } from "./browser.js";
import { createDatabase, ensureDataDir } from "./db.js";
import { parseSearchProfilesFile } from "./importers.js";
import { Repository } from "./repository.js";

const rootDir = process.cwd();
const distRoot = path.join(rootDir, "dist");
const publicDir = path.join(distRoot, "public");
const dataDir = ensureDataDir(rootDir);
const database = createDatabase(path.join(dataDir, "job-search.sqlite"));
const repository = new Repository(database, indeedAdapter);

const app = express();
const upload = multer();
const port = Number(process.env.PORT ?? 4312);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function getSummary(): AppSummary {
  return {
    searches: repository.listSearchProfiles(),
    jobs: repository.listJobs(),
    runs: repository.listRuns()
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

app.post("/api/runs", async (_req, res) => {
  try {
    const searches = repository.listSearchProfiles();
    if (!searches.length) {
      res.status(400).json({ error: "Import at least one search profile before running searches." });
      return;
    }

    const urls = searches.map((profile) => indeedAdapter.buildSearchUrl(profile));
    const run = repository.createRun(urls.length);
    await openSearchUrls(urls);
    res.json({ run, urls });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to launch search URLs."
    });
  }
});

app.post("/api/captures", (req, res) => {
  try {
    const payload = capturePayloadSchema.parse(req.body);
    const knownProfile = repository.listSearchProfiles().some((profile) => profile.id === payload.searchProfileId);
    if (!knownProfile) {
      res.status(400).json({ error: `Unknown search profile '${payload.searchProfileId}'.` });
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
