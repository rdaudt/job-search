import type { Repository } from "../repository.js";
import type { OpenAIRelevanceClassifier } from "./openai-classifier.js";

const IDLE_DELAY_MS = 3000;
const ERROR_DELAY_MS = 8000;

export function startRelevanceWorker(repository: Repository, classifier: OpenAIRelevanceClassifier): void {
  let running = false;

  async function tick(): Promise<void> {
    if (running) {
      globalThis.setTimeout(() => void tick(), IDLE_DELAY_MS);
      return;
    }

    running = true;
    let pendingItem: ReturnType<Repository["getNextPendingRelevanceItem"]> = null;
    try {
      pendingItem = repository.getNextPendingRelevanceItem();
      if (!pendingItem) {
        globalThis.setTimeout(() => void tick(), IDLE_DELAY_MS);
        return;
      }

      const result = await classifier.classify({
        searchProfileName: pendingItem.searchProfileName,
        keywords: pendingItem.keywords,
        remote: pendingItem.remote,
        globalGuidance: pendingItem.globalGuidance,
        jobOverrideNote: pendingItem.jobOverrideNote,
        title: pendingItem.title,
        company: pendingItem.company,
        location: pendingItem.location,
        summary: pendingItem.summary
      });

      repository.completeRelevance(
        pendingItem.jobId,
        pendingItem.searchProfileId,
        classifier.model,
        classifier.promptVersion,
        result,
      );
      globalThis.setTimeout(() => void tick(), 0);
    } catch (error) {
      if (error instanceof Error) {
        if (pendingItem) {
          repository.failRelevance(pendingItem.jobId, pendingItem.searchProfileId);
        }
        console.error("Relevance worker failed", error);
      }
      globalThis.setTimeout(() => void tick(), ERROR_DELAY_MS);
    } finally {
      running = false;
    }
  }

  void tick();
}
