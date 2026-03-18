import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indeedAdapter } from "../src/shared/indeed.js";
import type { CapturePayload } from "../src/shared/types.js";
import { createDatabase } from "../src/server/db.js";
import { Repository } from "../src/server/repository.js";

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

    const payload: CapturePayload = {
      source: "indeed",
      searchProfileId: "one",
      pageUrl: "https://www.indeed.com/jobs?q=react#job-finder-profile=one",
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
    repository.ingestCapture({ ...payload, searchProfileId: "two" });

    const jobs = repository.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].matchingSearchProfiles).toEqual(["One", "Two"]);
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

    repository.ingestCapture({
      source: "indeed",
      searchProfileId: "one",
      pageUrl: "https://www.indeed.com/jobs?q=react#job-finder-profile=one",
      listings: [
        {
          sourceJobId: "jk123",
          url: "https://www.indeed.com/viewjob?jk=jk123",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Remote"
        }
      ]
    });

    const job = repository.listJobs()[0];
    repository.updateJobStatus(job.id, "saved");

    const csv = repository.exportJobsCsv();
    expect(csv).toContain("Frontend Engineer");
    expect(csv).toContain("saved");
  });
});
