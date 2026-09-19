import { afterEach, describe, expect, it, vi } from 'vitest';

import { evaluateWithJev, MODEL, OPENROUTER_URL } from './openrouter.ts';
import type {
  JevDecisionResponse,
  JevState,
  RetryOptions,
} from './openrouter.ts';
import { questions } from './questions.ts';

describe('evaluateWithJev', () => {
  const state: JevState = {
    job: { name: 'quality', command: 'pnpm check', exit_code: 1 },
    change: {
      changed_files: ['example/cart.ts'],
      diff: '...',
    },
    logs: 'FAIL example/cart.test.ts: expected 2000 to be 3000',
  };

  const successBody: JevDecisionResponse = {
    answers: {
      failure_category: {
        type: 'choice',
        choice: 'test_failure',
        confidence: 0.9,
        probabilities: { test_failure: 0.9 },
      },
      change_related: { type: 'noul', noul: 0.77 },
      diagnostic_clarity: {
        type: 'score',
        score: 1,
        confidence: 0.8,
        probabilities: { '0': 0.1, '1': 0.8, '2': 0.1 },
      },
    },
    id: 'gen-dec-1',
    model: 'typesafe/jev-1.13',
    usage: { cost: 0.00002, input_tokens: 10, output_tokens: 5 },
  };

  // Zero backoff: the tests only count attempts.
  const fastRetry: RetryOptions = { attempts: 3, baseDelayMs: 0 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the model, state, and questions to the decisions endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(successBody), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await evaluateWithJev({ apiKey: 'sk-test', state, questions });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe(OPENROUTER_URL);

    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('Authorization')).toBe('Bearer sk-test');
    expect(headers.get('Content-Type')).toBe('application/json');

    expect(JSON.parse(init.body as string)).toEqual({
      model: MODEL,
      state,
      questions,
    });
  });

  it('returns the parsed decisions response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(successBody), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await evaluateWithJev({
      apiKey: 'sk-test',
      state,
      questions,
    });

    expect(result).toEqual(successBody);
  });

  it('throws the API error message when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 401, message: 'Missing Authentication header' },
        }),
        { status: 401 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      evaluateWithJev({ apiKey: 'sk-test', state, questions }),
    ).rejects.toThrow('Missing Authentication header');
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      evaluateWithJev({ apiKey: 'sk-test', state, questions }),
    ).rejects.toThrow('OpenRouter request failed with status 500');
  });

  it('throws when a successful response has an unexpected top-level shape', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      evaluateWithJev({ apiKey: 'sk-test', state, questions }),
    ).rejects.toThrow(/missing required top-level fields/);
  });

  // 429 and 529 are retryable per the API docs.
  it('retries a rate-limited request and returns the retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 429, message: 'Rate limited' } }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successBody), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await evaluateWithJev({
      apiKey: 'sk-test',
      state,
      questions,
      retry: fastRetry,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(successBody);
  });

  it('gives up after the last attempt and throws the API error', async () => {
    // A body can only be read once, so return a fresh Response per call.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 529, message: 'Overloaded' } }),
          { status: 529 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      evaluateWithJev({
        apiKey: 'sk-test',
        state,
        questions,
        retry: fastRetry,
      }),
    ).rejects.toThrow('Overloaded');

    expect(fetchMock).toHaveBeenCalledTimes(fastRetry.attempts);
  });

  it('does not retry a client error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 422, message: 'Bad question' } }),
        {
          status: 422,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      evaluateWithJev({
        apiKey: 'sk-test',
        state,
        questions,
        retry: fastRetry,
      }),
    ).rejects.toThrow('Bad question');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('names the endpoint when the request never reaches OpenRouter', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      evaluateWithJev({
        apiKey: 'sk-test',
        state,
        questions,
        retry: fastRetry,
      }),
    ).rejects.toThrow(
      `The Jev request to ${OPENROUTER_URL} failed: fetch failed`,
    );
  });
});
