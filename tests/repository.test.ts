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
        location: "",
        remote: true
      },
      {
        id: "two",
        name: "Two",
        keywords: "typescript",
        location: "",
        remote: true
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 2,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

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
    expect(jobs[0].matchingRunLocations).toEqual([]);
  });

  it("exports CSV with the latest job state", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "one",
        name: "One",
        keywords: "react",
        location: "",
        remote: true
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, ["Vancouver, BC", "Burnaby, BC"]), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 3,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

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

  it("exports only effectively relevant jobs for the HTML snapshot", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "fitness",
        name: "Fitness",
        keywords: "fitness coach",
        location: "",
        remote: true
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=fitness+coach",
      listings: [
        {
          sourceJobId: "jk-fit",
          url: "https://ca.indeed.com/viewjob?jk=jk-fit",
          title: "Fitness Coach",
          company: "Acme",
          location: "Remote"
        },
        {
          sourceJobId: "jk-pt",
          url: "https://ca.indeed.com/viewjob?jk=jk-pt",
          title: "PT Steward",
          company: "Other",
          location: "Remote"
        }
      ]
    });

    const jobs = repository.listJobs();
    repository.setJobRelevanceOverride(jobs[0].id, "relevant", "Clearly in scope.");
    repository.setJobRelevanceOverride(jobs[1].id, "irrelevant", "Wrong role.");

    const exportJobs = repository.listRelevantJobsForExport();
    expect(exportJobs).toHaveLength(1);
    expect(exportJobs[0].title).toBe("Fitness Coach");
  });

  it("exports only the selected visible relevant jobs in the requested order", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "fitness",
        name: "Fitness",
        keywords: "fitness coach",
        location: "",
        remote: true
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=fitness+coach",
      listings: [
        {
          sourceJobId: "jk-fit",
          url: "https://ca.indeed.com/viewjob?jk=jk-fit",
          title: "Fitness Coach",
          company: "Acme",
          location: "Remote"
        },
        {
          sourceJobId: "jk-lead",
          url: "https://ca.indeed.com/viewjob?jk=jk-lead",
          title: "Fitness Manager",
          company: "Club",
          location: "Remote"
        },
        {
          sourceJobId: "jk-nope",
          url: "https://ca.indeed.com/viewjob?jk=jk-nope",
          title: "PT Steward",
          company: "Other",
          location: "Remote"
        }
      ]
    });

    const jobs = repository.listJobs();
    repository.setJobRelevanceOverride(jobs[0].id, "relevant", "In scope.");
    repository.setJobRelevanceOverride(jobs[1].id, "relevant", "Also in scope.");
    repository.setJobRelevanceOverride(jobs[2].id, "irrelevant", "Wrong role.");

    const exportJobs = repository.listRelevantJobsForExportByIds([jobs[1].id, jobs[2].id, jobs[0].id]);
    expect(exportJobs.map((job) => job.id)).toEqual([jobs[1].id, jobs[0].id]);
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
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 2,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

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

  it("drops non-Canadian listings even when they match the search keywords", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "frontend",
        name: "Frontend",
        keywords: "frontend engineer",
        location: "",
        remote: false
      }
    ]);
    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 2,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer",
      listings: [
        {
          sourceJobId: "jk-ca",
          url: "https://ca.indeed.com/viewjob?jk=jk-ca",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Vancouver, BC"
        },
        {
          sourceJobId: "jk-us",
          url: "https://ca.indeed.com/viewjob?jk=jk-us",
          title: "Frontend Engineer",
          company: "Other",
          location: "Seattle, WA"
        }
      ]
    });

    const jobs = repository.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBe("Vancouver, BC");
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
    const { run, targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 3,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });
    expect(run.maxPages).toBe(3);
    expect(run.retentionMode).toBe("cumulative");
    expect(run.runMode).toBe("fixed");

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

  it("stores auto mode settings on runs and targets", () => {
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
    const { run, targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "auto",
      maxPages: 3,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    expect(run.runMode).toBe("auto");
    expect(run.retentionMode).toBe("cumulative");
    expect(run.zeroNewJobsThreshold).toBe(2);
    expect(run.emergencyMaxPages).toBe(50);
    expect(run.searchLaunchDelayMs).toBe(20_000);
    expect(run.pageDelayJitterMs).toBe(12_000);
    expect(targets[0].runMode).toBe("auto");
    expect(targets[0].zeroNewJobsThreshold).toBe(2);
    expect(targets[0].emergencyMaxPages).toBe(50);
    expect(targets[0].searchLaunchJitterMs).toBe(20_000);
    expect(targets[0].pageDelayMs).toBe(8_000);
  });

  it("queues pending relevance and reuses cached decisions when unchanged", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "fitness",
        name: "Fitness",
        keywords: "fitness coach",
        location: "Vancouver, BC",
        remote: false
      }
    ]);

    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=fitness+coach&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk-fit",
          url: "https://ca.indeed.com/viewjob?jk=jk-fit",
          title: "Fitness Coach",
          company: "Acme",
          location: "Vancouver, BC",
          summary: "Coach clients in the gym"
        }
      ]
    });

    repository.queueRelevanceForRunTarget(targets[0].id, {
      model: "gpt-5.4",
      promptVersion: "relevance-v1"
    });

    let jobs = repository.listJobs();
    expect(jobs[0].relevanceStatus).toBe("pending");

    const pending = repository.getNextPendingRelevanceItem();
    expect(pending?.jobId).toBe(jobs[0].id);
    expect(pending?.globalGuidance).toBe("");
    expect(pending?.jobOverrideNote).toBeNull();

    repository.completeRelevance(jobs[0].id, "fitness", "gpt-5.4", "relevance-v1", {
      relevance: "relevant",
      confidence: 0.92,
      reason: "Strong title match",
      signals: ["fitness", "coach"],
      disqualifiers: []
    });

    repository.queueRelevanceForRunTarget(targets[0].id, {
      model: "gpt-5.4",
      promptVersion: "relevance-v1"
    });

    jobs = repository.listJobs();
    expect(jobs[0].relevanceStatus).toBe("complete");
    expect(jobs[0].relevanceLabel).toBe("relevant");
    expect(jobs[0].relevanceReason).toBe("Strong title match");
    expect(repository.getNextPendingRelevanceItem()).toBeNull();
  });

  it("applies user overrides as the effective relevance and requeues jobs when guidance changes", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "fitness",
        name: "Fitness",
        keywords: "fitness coach",
        location: "Vancouver, BC",
        remote: false
      }
    ]);

    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=fitness+coach&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk-fit",
          url: "https://ca.indeed.com/viewjob?jk=jk-fit",
          title: "Kinesiologist",
          company: "Acme",
          location: "Vancouver, BC",
          summary: "Help members train"
        }
      ]
    });

    repository.queueRelevanceForRunTarget(targets[0].id, {
      model: "gpt-5.4",
      promptVersion: "relevance-v1"
    });

    let job = repository.listJobs()[0];
    repository.completeRelevance(job.id, "fitness", "gpt-5.4", "relevance-v1", {
      relevance: "irrelevant",
      confidence: 0.86,
      reason: "Not a coach role",
      signals: ["kinesiology"],
      disqualifiers: ["coach missing"]
    });

    repository.setJobRelevanceOverride(job.id, "relevant", "Kinesiology jobs shall be considered relevant.");
    job = repository.listJobs()[0];
    expect(job.hasUserOverride).toBe(true);
    expect(job.userOverrideLabel).toBe("relevant");
    expect(job.effectiveRelevanceLabel).toBe("relevant");
    expect(job.effectiveRelevanceExplanation).toBe("Kinesiology jobs shall be considered relevant.");

    repository.setRelevanceGuidance("Management-track jobs in my field are relevant.");
    repository.queueRelevanceForAllJobs({
      model: "gpt-5.4",
      promptVersion: "relevance-v1"
    });

    const pending = repository.getNextPendingRelevanceItem();
    expect(pending?.jobId).toBe(job.id);
    expect(pending?.globalGuidance).toBe("Management-track jobs in my field are relevant.");
    expect(pending?.jobOverrideNote).toBe("Kinesiology jobs shall be considered relevant.");

    repository.completeRelevance(job.id, "fitness", "gpt-5.4", "relevance-v1", {
      relevance: "irrelevant",
      confidence: 0.9,
      reason: "Still outside the target coaching roles",
      signals: ["kinesiology"],
      disqualifiers: ["coach missing"]
    });

    repository.clearJobRelevanceOverride(job.id);
    job = repository.listJobs()[0];
    expect(job.hasUserOverride).toBe(false);
    expect(job.effectiveRelevanceLabel).toBe("irrelevant");
    expect(job.effectiveRelevanceExplanation).toBe("Still outside the target coaching roles");
  });

  it("reports aggregate AI review status", () => {
    const repository = createRepository();
    repository.replaceSearchProfiles([
      {
        id: "fitness",
        name: "Fitness",
        keywords: "fitness coach",
        location: "Vancouver, BC",
        remote: false
      }
    ]);

    expect(repository.getAiReviewSummary()).toEqual({
      pendingCount: 0,
      completeCount: 0,
      failedCount: 0,
      totalCount: 0,
      status: "idle",
      lastUpdatedAt: null
    });

    const searches = repository.listSearchProfiles();
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=fitness+coach&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk-fit",
          url: "https://ca.indeed.com/viewjob?jk=jk-fit",
          title: "Fitness Coach",
          company: "Acme",
          location: "Vancouver, BC"
        }
      ]
    });

    repository.queueRelevanceForRunTarget(targets[0].id, {
      model: "gpt-5.4",
      promptVersion: "relevance-v1"
    });

    let summary = repository.getAiReviewSummary();
    expect(summary.pendingCount).toBe(1);
    expect(summary.status).toBe("in_progress");

    const job = repository.listJobs()[0];
    repository.completeRelevance(job.id, "fitness", "gpt-5.4", "relevance-v1", {
      relevance: "relevant",
      confidence: 0.91,
      reason: "Strong match",
      signals: ["fitness"],
      disqualifiers: []
    });

    summary = repository.getAiReviewSummary();
    expect(summary.completeCount).toBe(1);
    expect(summary.status).toBe("completed");

    repository.queueRelevanceForAllJobs({
      model: "gpt-5.4",
      promptVersion: "relevance-v1"
    });
    repository.failRelevance(job.id, "fitness");

    summary = repository.getAiReviewSummary();
    expect(summary.failedCount).toBe(1);
    expect(summary.status).toBe("completed_with_failures");
  });

  it("keeps captured jobs across search imports until a reset run is requested", () => {
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

    let searches = repository.listSearchProfiles();
    let run = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 2,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: run.targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk-keep",
          url: "https://ca.indeed.com/viewjob?jk=jk-keep",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Vancouver, BC"
        }
      ]
    });

    const savedJob = repository.listJobs()[0];
    repository.updateJobStatus(savedJob.id, "saved");

    repository.replaceSearchProfiles([
      {
        id: "backend",
        name: "Backend",
        keywords: "backend engineer",
        location: "Toronto, ON",
        remote: false
      }
    ]);

    let jobs = repository.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("saved");
    expect(jobs[0].matchingSearchProfiles).toEqual(["Frontend"]);

    searches = repository.listSearchProfiles();
    run = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 2,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: run.targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer&l=Toronto%2C+ON",
      listings: [
        {
          sourceJobId: "jk-keep",
          url: "https://ca.indeed.com/viewjob?jk=jk-keep",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Toronto, ON"
        }
      ]
    });

    jobs = repository.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("saved");
    expect(jobs[0].matchingSearchProfiles).toEqual(["Backend", "Frontend"]);

    repository.resetCapturedData();
    expect(repository.listJobs()).toHaveLength(0);
    expect(repository.listRuns()).toHaveLength(0);
    expect(repository.listSearchProfiles()).toHaveLength(1);
  });

  it("deletes a single job without touching other jobs", () => {
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
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk-one",
          url: "https://ca.indeed.com/viewjob?jk=jk-one",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Vancouver, BC"
        },
        {
          sourceJobId: "jk-two",
          url: "https://ca.indeed.com/viewjob?jk=jk-two",
          title: "Frontend Engineer II",
          company: "Beta",
          location: "Vancouver, BC"
        }
      ]
    });

    const jobs = repository.listJobs();
    expect(repository.deleteJob(jobs[0].id)).toBe(true);
    expect(repository.deleteJob(999999)).toBe(false);
    expect(repository.listJobs()).toHaveLength(1);
  });

  it("clears jobs while preserving run history", () => {
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
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk-one",
          url: "https://ca.indeed.com/viewjob?jk=jk-one",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Vancouver, BC"
        }
      ]
    });

    const result = repository.clearJobsData();
    expect(result.deletedJobs).toBe(1);
    expect(repository.listJobs()).toHaveLength(0);
    expect(repository.listRuns()).toHaveLength(1);
    expect(repository.listLatestRunTargets()).toHaveLength(1);
  });

  it("clears all captured data including runs while preserving searches", () => {
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
    const { targets } = repository.createRun(buildRunTargetTemplates(searches, []), {
      retentionMode: "cumulative",
      runMode: "fixed",
      maxPages: 1,
      zeroNewJobsThreshold: 2,
      emergencyMaxPages: 50,
      searchLaunchDelayMs: 20_000,
      searchLaunchJitterMs: 20_000,
      pageDelayMs: 8_000,
      pageDelayJitterMs: 12_000
    });

    repository.ingestCapture({
      source: "indeed",
      runTargetId: targets[0].id,
      pageUrl: "https://ca.indeed.com/jobs?q=frontend+engineer&l=Vancouver%2C+BC",
      listings: [
        {
          sourceJobId: "jk-one",
          url: "https://ca.indeed.com/viewjob?jk=jk-one",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Vancouver, BC"
        }
      ]
    });

    const result = repository.clearAllData();
    expect(result.deletedJobs).toBe(1);
    expect(result.deletedRuns).toBe(1);
    expect(repository.listJobs()).toHaveLength(0);
    expect(repository.listRuns()).toHaveLength(0);
    expect(repository.listLatestRunTargets()).toHaveLength(0);
    expect(repository.listSearchProfiles()).toHaveLength(1);
  });
});
