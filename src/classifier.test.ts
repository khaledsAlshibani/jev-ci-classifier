import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyCIFailure } from './classifier.ts';
import { evaluateWithJev } from './openrouter.ts';
import type { JevAnswer, JevDecisionResponse, JevState } from './openrouter.ts';
import { questions } from './questions.ts';

vi.mock('./openrouter.ts', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('./openrouter.ts');
  return {
    ...actual,
    evaluateWithJev: vi.fn(),
  };
});

const mockedEvaluateWithJev = vi.mocked(evaluateWithJev);

const state: JevState = {
  job: { name: 'quality', command: 'pnpm check', exit_code: 1 },
  change: {
    changed_files: ['example/cart.ts'],
    diff: '...',
  },
  logs: 'FAIL example/cart.test.ts > calculateTotal > calculates the total for multiple items\nAssertionError: expected 2000 to be 3000',
};

// Synthetic Jev response, same shape as the real API.
const validResponse: JevDecisionResponse = {
  answers: {
    failure_category: {
      type: 'choice',
      choice: 'test_failure',
      confidence: 0.9,
      probabilities: {
        lint_failure: 0.01,
        type_failure: 0.04,
        test_failure: 0.9,
        dependency_failure: 0.03,
        ci_environment_failure: 0.01,
        unknown: 0.01,
      },
    },
    change_related: {
      type: 'noul',
      noul: 0.77,
    },
    diagnostic_clarity: {
      type: 'score',
      score: 1,
      confidence: 0.8,
      probabilities: {
        '0': 0.1,
        '1': 0.8,
        '2': 0.1,
      },
    },
  },
  id: 'gen-dec-test',
  model: 'typesafe/jev-1.13',
  provider: 'TypeSafe',
  usage: {
    cost: 0.000019992,
    input_tokens: 476,
    output_tokens: 70,
  },
};

describe('classifyCIFailure', () => {
  beforeEach(() => {
    mockedEvaluateWithJev.mockReset();
  });

  it('preserves the value, confidence, and probabilities of each answer', async () => {
    mockedEvaluateWithJev.mockResolvedValue(validResponse);

    const result = await classifyCIFailure('sk-test', state);

    expect(result.failureCategory).toEqual({
      value: 'test_failure',
      confidence: 0.9,
      probabilities: {
        lint_failure: 0.01,
        type_failure: 0.04,
        test_failure: 0.9,
        dependency_failure: 0.03,
        ci_environment_failure: 0.01,
        unknown: 0.01,
      },
    });

    // Noul stays a raw probability, no threshold is applied.
    expect(result.changeRelated).toEqual({ probability: 0.77 });

    expect(result.diagnosticClarity).toEqual({
      score: 1,
      confidence: 0.8,
      probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 },
    });

    expect(result.response).toBe(validResponse);
  });

  it('sends the state and the full question set to Jev', async () => {
    mockedEvaluateWithJev.mockResolvedValue(validResponse);

    await classifyCIFailure('sk-test', state);

    expect(mockedEvaluateWithJev).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      state,
      questions,
    });
  });

  it('throws a clear error when an answer is missing', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        failure_category: validResponse.answers.failure_category!,
        change_related: validResponse.answers.change_related!,
      },
    });

    await expect(classifyCIFailure('sk-test', state)).rejects.toThrow(
      /missing the "diagnostic_clarity" answer/,
    );
  });

  it('throws a clear error when an answer has the wrong type', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        failure_category: { type: 'noul', noul: 0.9 },
      },
    });

    await expect(classifyCIFailure('sk-test', state)).rejects.toThrow(
      /Expected a "choice" answer for "failure_category" but got a "noul" answer/,
    );
  });

  it('throws when the choice is not a known failure category', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        failure_category: {
          type: 'choice',
          choice: 'flaky_network',
          confidence: 0.9,
          probabilities: { flaky_network: 1 },
        },
      },
    });

    await expect(classifyCIFailure('sk-test', state)).rejects.toThrow(
      /"failure_category" is not a known failure category: "flaky_network"/,
    );
  });

  // Confidence and probabilities are optional.
  it('reports no confidence when the answer carries none', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        failure_category: {
          type: 'choice',
          choice: 'test_failure',
          probabilities: { test_failure: 1 },
        },
      },
    });

    const result = await classifyCIFailure('sk-test', state);

    expect(result.failureCategory).toEqual({
      value: 'test_failure',
      probabilities: { test_failure: 1 },
    });
  });

  it('reports an empty distribution when probabilities are missing', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        failure_category: {
          type: 'choice',
          choice: 'test_failure',
          confidence: 0.9,
        },
      },
    });

    const result = await classifyCIFailure('sk-test', state);

    expect(result.failureCategory).toEqual({
      value: 'test_failure',
      confidence: 0.9,
      probabilities: {},
    });
  });

  it('throws when a noul answer falls outside 0..1', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        change_related: { type: 'noul', noul: 1.5 },
      },
    });

    await expect(classifyCIFailure('sk-test', state)).rejects.toThrow(
      /must be a probability between 0 and 1/,
    );
  });

  // Split probabilities can put the score between two levels.
  it('keeps a fractional score as reported', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        diagnostic_clarity: {
          type: 'score',
          score: 1.3,
          confidence: 0.55,
          probabilities: { 0: 0, 1: 0.7, 2: 0.3 },
        },
      },
    });

    const result = await classifyCIFailure('sk-test', state);

    expect(result.diagnosticClarity.score).toBe(1.3);
  });

  it('throws when the diagnostic clarity score is above the top level', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        diagnostic_clarity: {
          type: 'score',
          score: 3,
          confidence: 0.8,
          probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 },
        },
      },
    });

    await expect(classifyCIFailure('sk-test', state)).rejects.toThrow(
      /"diagnostic_clarity" score must be between 0 and 2, got 3/,
    );
  });

  it('throws when the diagnostic clarity score is not a number', async () => {
    const invalidScoreAnswer = {
      type: 'score',
      score: 'high',
      confidence: 0.8,
      probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 },
    } as unknown as JevAnswer;

    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        diagnostic_clarity: invalidScoreAnswer,
      },
    });

    await expect(classifyCIFailure('sk-test', state)).rejects.toThrow(
      /"diagnostic_clarity" score must be a number/,
    );
  });

  it('throws when a failure category confidence falls outside 0..1', async () => {
    mockedEvaluateWithJev.mockResolvedValue({
      ...validResponse,
      answers: {
        ...validResponse.answers,
        failure_category: {
          type: 'choice',
          choice: 'test_failure',
          confidence: 1.5,
          probabilities: { test_failure: 0.9 },
        },
      },
    });

    await expect(classifyCIFailure('sk-test', state)).rejects.toThrow(
      /"failure_category" confidence must be between 0 and 1/,
    );
  });
});
