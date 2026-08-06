export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
}

export interface ChatOptions {
  /** Model passed to the upstream conversation (`auto` default, e.g. `gpt-5-5`). */
  model?: string;
  /** Upstream anonymous host. Defaults to `https://android.chat.openai.com`. */
  anonBase?: string;
  /** Fixed device id (15 digits). Generated per call when omitted. */
  deviceId?: string;
  /** Extra attempts after a failure or truncated answer (default 2). Only used by `chat()`. */
  retries?: number;
  /** Re-run the turn when the answer ends mid-sentence (default true). Only used by `chat()`. */
  retryTruncated?: boolean;
}

export interface OpenAIDelta {
  role?: string;
  content?: string;
  reasoning_content?: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIStreamEvent {
  model: string;
  delta: OpenAIDelta | null;
  finished: boolean;
  errored: boolean;
  assistantText: string;
  reasoningText: string;
  usage?: Usage;
}

export interface ChatResult {
  model: string;
  content: string;
  reasoning: string;
  usage: Usage | null;
  finish_reason: 'stop' | 'error';
}