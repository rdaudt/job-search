import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indeedAdapter } from "../src/shared/indeed.js";
import type { CapturePayload } from "../src/shared/types.js";
import { createDatabase } from "../src/server/db.js";
import { Repository } from "../src/server/repository.js";
import { buildRunTargetTemplates } from "../src/server/run-targets.js";

const cleanupEntries: Array<{ tempDir: string; repository: Repository }> = [];

function createRepository(): Repository {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-search-finder-"));
  const database = createDatabase(path.join(tempDir, "test.sqlite"));
  const repository = new Repository(database, indeedAdapter);
  cleanupEntries.push({ tempDir, repository });
  return repository;
}

afterEach(() => {
  for (const entry of cleanupEntries.splice(0)) {
    entry.repository.close();
    const tempDir = entry.tempDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Repository", () => {
  it("deduplicates captures across runs and profiles", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "one",
        name: "One",
        keywords: "react",
        location: "Remote",
        remote: true
      },
      {
        id: "two",
        name: "Two",
        keywords: "typescript",
        location: "Remote",
        remote: true
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), 2);

    const payload: CapturePayload = {
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://www.indeed.com/jobs?q=react&jobFinderRunTarget=test",
      listings: [
        {
          sourceJobId: "jk123",
          url: "https://www.indeed.com/viewjob?jk=jk123",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Remote",
          summary: "Build interfaces"
        }
      ]
    };

    repository.ingestCapture(payload);
    repository.ingestCapture({ ...payload, runTargetId: targets[1].id });

    const jobs = repository.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].matchingSearchProfiles).toEqual(["One", "Two"]);
    expect(jobs[0].matchingRunLocations).toEqual(["Remote"]);
  });

  it("exports CSV with the latest job state", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "one",
        name: "One",
        keywords: "react",
        location: "Remote",
        remote: true
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, ["Vancouver, BC", "Burnaby, BC"]), 3);

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://www.indeed.com/jobs?q=react&jobFinderRunTarget=test",
      listings: [
        {
          sourceJobId: "jk123",
          url: "https://www.indeed.com/viewjob?jk=jk123",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Vancouver, BC"
        }
      ]
    });

    const job = repository.listJobs()[0];
    repository.updateJobStatus(job.id, "saved");

    const csv = repository.exportJobsCsv();
    expect(csv).toContain("Frontend Engineer");
    expect(csv).toContain("saved");
    expect(csv).toContain("Vancouver, BC");
  });

  it("keeps remote listings for remote profiles scoped to a city", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "remote-vancouver",
        name: "Remote Vancouver",
        keywords: "frontend engineer",
        location: "Vancouver, BC",
        remote: true
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), 2);

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer+remote&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk999",
          url: "https://ca.indeed.com/viewjob?jk=jk999",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Remote in British Columbia"
        }
      ]
    });

    const jobs = repository.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].matchingRunLocations).toEqual(["Vancouver, BC"]);
  });

  it("tracks page progress and terminal state per run target", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "frontend",
        name: "Frontend",
        keywords: "frontend engineer",
        location: "Vancouver, BC",
        remote: false
      }
    ]);

    const searches = repository.listSearchProfiles();
    const { run, targets } = repository.createRun(buildRunTargetTemplates(searches, []), 3);
    expect(run.maxPages).toBe(3);

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer&l=Vancouver%2C+BC",
      pageNumber: 2,
      listings: [
        {
          sourceJobId: "jk-progress",
          url: "https://ca.indeed.com/viewjob?jk=jk-progress",
          title: "Frontend Engineer II",
          company: "Acme",
          location: "Vancouver, BC"
        }
      ]
    });
    repository.updateRunTargetState(targets[0].id, {
      status: "completed",
      stopReason: "page-limit-reached",
      pageNumber: 2,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer&l=Vancouver%2C+BC&start=10"
    });

    const latestTarget = repository.listLatestRunTargets()[0];
    expect(latestTarget.pagesCaptured).toBe(2);
    expect(latestTarget.maxPages).toBe(3);
    expect(latestTarget.status).toBe("completed");
    expect(latestTarget.stopReason).toBe("page-limit-reached");
    expect(latestTarget.lastPageNumber).toBe(2);
  });
});
