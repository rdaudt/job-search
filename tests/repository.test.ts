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
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []));

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
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, ["Vancouver, BC", "Burnaby, BC"]));

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
});
