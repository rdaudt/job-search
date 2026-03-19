import type { RelevanceLabel } from "../../shared/types.js";
import type { RelevanceJobInput, RelevanceResult } from "./utils.js";
import { OPENAI_RELEVANCE_PROMPT_VERSION } from "./utils.js";

type OpenAIClassifierOptions = {
  apiKey: string;
  model: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  baseUrl?: string;
};

type ParsedResponse = {
  relevance: RelevanceLabel;
  confidence: number;
  reason: string;
  signals?: string[];
  disqualifiers?: string[];
};

const responseSchema = {
  name: "job_profile_relevance",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["relevance", "confidence", "reason", "signals", "disqualifiers"],
    properties: {
      relevance: {
        type: "string",
        enum: ["relevant", "borderline", "irrelevant"]
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1
      },
      reason: {
        type: "string",
        minLength: 1,
        maxLength: 240
      },
      signals: {
        type: "array",
        items: {
          type: "string"
        },
        maxItems: 5
      },
      disqualifiers: {
        type: "array",
        items: {
          type: "string"
        },
        maxItems: 5
      }
    }
  },
  strict: true
} as const;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function extractOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: unknown[] }).content)
      : [];
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const text = (contentItem as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) {
        return text;
      }
    }
  }

  return null;
}

export class OpenAIRelevanceClassifier {
  readonly model: string;
  readonly promptVersion = OPENAI_RELEVANCE_PROMPT_VERSION;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";

  constructor(options: OpenAIClassifierOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.reasoningEffort = options.reasoningEffort ?? "low";
  }

  async classify(input: RelevanceJobInput): Promise<RelevanceResult> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: {
          effort: this.reasoningEffort
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You classify whether a captured job listing is relevant to a specific user search profile. Judge from the perspective of whether the user would want to review the job. Prefer precision over recall for obviously unrelated jobs. Use the title heavily and the summary as support. Return only the requested JSON schema."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  searchProfileName: input.searchProfileName,
                  keywords: input.keywords,
                  remote: input.remote,
                  job: {
                    title: input.title,
                    company: input.company,
                    location: input.location,
                    summary: input.summary
                  }
                })
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            ...responseSchema
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `OpenAI request failed with ${response.status}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const rawText = extractOutputText(payload);
    if (!rawText) {
      throw new Error("OpenAI response did not contain structured output.");
    }

    const parsed = JSON.parse(rawText) as ParsedResponse;
    if (!["relevant", "borderline", "irrelevant"].includes(parsed.relevance)) {
      throw new Error("OpenAI response contained an invalid relevance label.");
    }

    return {
      relevance: parsed.relevance,
      confidence: clampConfidence(parsed.confidence),
      reason: parsed.reason.trim(),
      signals: Array.isArray(parsed.signals) ? parsed.signals.map((value) => `${value}`.trim()).filter(Boolean) : [],
      disqualifiers: Array.isArray(parsed.disqualifiers)
        ? parsed.disqualifiers.map((value) => `${value}`.trim()).filter(Boolean)
        : []
    };
  }
}
