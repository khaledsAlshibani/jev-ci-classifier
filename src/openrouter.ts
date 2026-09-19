import type { QuestionSet } from './questions.ts';

export const OPENROUTER_URL = 'https://openrouter.ai/api/alpha/decisions';
export const MODEL = 'typesafe/jev-1.13';

export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Retry rate-limit and overload responses.
 */
export const RETRYABLE_STATUS = [429, 529];

export const DEFAULT_RETRY: RetryOptions = { attempts: 3, baseDelayMs: 500 };

/**
 * Jev state can be a string, object, or array.
 */
export type JevState = string | Record<string, unknown> | unknown[];

export interface NoulAnswer {
  type: 'noul';
  /**
   * Probability (0..1) of `true`. Noul has no separate confidence.
   */
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface ScoreAnswer {
  type: 'score';
  /**
   * Position on the scale from 0 to criteria.length - 1, often between two levels.
   */
  score: number;
  confidence?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
  /**
   * Added by OpenRouter, the model API reports tokens only.
   */
  cost?: number;
}

export interface JevDecisionResponse {
  answers: Record<string, JevAnswer>;
  id?: string;
  model: string;
  provider?: string;
  usage: JevUsage;
}

export interface JevApiError {
  error: {
    code: number;
    message: string;
  };
}

export interface RetryOptions {
  /**
   * Total attempts, first try included.
   */
  attempts: number;
  /**
   * Delay before the second try, doubled on each retry.
   */
  baseDelayMs: number;
}

export interface EvaluateWithJevParams {
  apiKey: string;
  state: JevState;
  questions: QuestionSet;
  retry?: RetryOptions;
}

export async function evaluateWithJev({
  apiKey,
  state,
  questions,
  retry = DEFAULT_RETRY,
}: EvaluateWithJevParams): Promise<JevDecisionResponse> {
  const body = JSON.stringify({ model: MODEL, state, questions });

  for (let attempt = 1; ; attempt++) {
    const response = await postDecisions(apiKey, body);
    const data = await readJson(response);

    if (response.ok) {
      return requireJevDecisionResponse(data);
    }

    const canRetry =
      RETRYABLE_STATUS.includes(response.status) && attempt < retry.attempts;
    if (!canRetry) {
      const error = data as JevApiError | undefined;
      throw new Error(
        error?.error?.message ??
          `OpenRouter request failed with status ${response.status}`,
      );
    }

    await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
  }
}

async function postDecisions(apiKey: string, body: string): Promise<Response> {
  try {
    return await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // fetch throws on network errors and timeouts. Add the endpoint to make the error easier to diagnose.
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`The Jev request to ${OPENROUTER_URL} failed: ${reason}`, {
      cause,
    });
  }
}

/**
 * Error bodies should be JSON, but a gateway can answer with HTML.
 */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks the top-level response shape, each answer is validated later in classifier.ts.
 */
function requireJevDecisionResponse(data: unknown): JevDecisionResponse {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('answers' in data) ||
    !('model' in data) ||
    !('usage' in data)
  ) {
    throw new Error(
      'The Jev response is missing required top-level fields: "answers", "model", "usage".',
    );
  }

  const response = data as JevDecisionResponse;
  if (typeof response.model !== 'string') {
    throw new Error('The Jev response field "model" must be a string.');
  }
  if (typeof response.answers !== 'object' || response.answers === null) {
    throw new Error('The Jev response field "answers" must be an object.');
  }
  if (typeof response.usage !== 'object' || response.usage === null) {
    throw new Error('The Jev response field "usage" must be an object.');
  }

  return response;
}
