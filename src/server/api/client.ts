import type { paths } from "@/generated/ai-builder-api";

const DEFAULT_BASE_URL = "https://space.ai-builders.com/backend";

type ChatRequest =
  paths["/v1/chat/completions"]["post"]["requestBody"]["content"]["application/json"];
type ChatResponse =
  paths["/v1/chat/completions"]["post"]["responses"]["200"]["content"]["application/json"];

export type TranscriptionResponse =
  paths["/v1/audio/transcriptions"]["post"]["responses"]["200"]["content"]["application/json"];

interface ApiClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class AiBuilderApiClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(options: ApiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.AI_BUILDER_API_KEY;
    this.baseUrl = options.baseUrl ?? process.env.AI_BUILDER_BASE_URL ?? DEFAULT_BASE_URL;
  }

  async chatCompletion(payload: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
  }

  async transcribeAudio(formData: FormData): Promise<TranscriptionResponse> {
    return this.request<TranscriptionResponse>("/v1/audio/transcriptions", {
      method: "POST",
      body: formData,
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`AI Builder API request failed (${response.status}): ${details}`);
    }

    return (await response.json()) as T;
  }
}
