import { evaluateWithJev } from './openrouter.ts';
import type { JevAnswer, JevDecisionResponse, JevState } from './openrouter.ts';
import { questions } from './questions.ts';

/**
 * The categories come from the question, so the type and the question list stay in sync.
 */
export type FailureCategory = keyof typeof questions.failure_category.criteria;

export const FAILURE_CATEGORIES = Object.keys(
  questions.failure_category.criteria,
) as FailureCategory[];

/**
 * Zero-based scale: the top level is the last index.
 */
const MAX_CLARITY_SCORE = questions.diagnostic_clarity.criteria.length - 1;

export interface FailureCategoryClassification {
  value: FailureCategory;
  confidence?: number;
  probabilities: Record<string, number>;
}

export interface ChangeRelatedClassification {
  /**
   * Probability from 0 to 1 that Jev assigns to the change causing the failure.
   */
  probability: number;
}

export interface DiagnosticClarityClassification {
  /**
   * Position on the scale, often between two levels.
   */
  score: number;
  confidence?: number;
  probabilities: Record<string, number>;
}

export interface ClassificationResult {
  failureCategory: FailureCategoryClassification;
  changeRelated: ChangeRelatedClassification;
  diagnosticClarity: DiagnosticClarityClassification;
  /**
   * The full Jev response.
   */
  response: JevDecisionResponse;
}

export async function classifyCIFailure(
  apiKey: string,
  state: JevState,
): Promise<ClassificationResult> {
  const response = await evaluateWithJev({ apiKey, state, questions });
  const answers = response.answers;

  return {
    failureCategory: readFailureCategory(answers),
    changeRelated: readChangeRelated(answers),
    diagnosticClarity: readDiagnosticClarity(answers),
    response,
  };
}

/**
 * Gets answer `name` or throws if it is missing.
 */
function requireAnswer(
  answers: Record<string, JevAnswer>,
  name: string,
): JevAnswer {
  const answer = answers[name];
  if (answer === undefined) {
    throw new Error(`Jev response is missing the "${name}" answer.`);
  }
  return answer;
}

/**
 * Confidence is optional and remains absent when Jev does not provide it.
 */
function readConfidence(
  name: string,
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(value >= 0 && value <= 1)) {
    throw new Error(
      `The "${name}" confidence must be between 0 and 1, got ${value}.`,
    );
  }
  return value;
}

function readFailureCategory(
  answers: Record<string, JevAnswer>,
): FailureCategoryClassification {
  const answer = requireAnswer(answers, 'failure_category');

  if (answer.type !== 'choice') {
    throw new Error(
      `Expected a "choice" answer for "failure_category" but got a "${answer.type}" answer.`,
    );
  }
  if (!isFailureCategory(answer.choice)) {
    throw new Error(
      `"failure_category" is not a known failure category: "${answer.choice}".`,
    );
  }

  return {
    value: answer.choice,
    confidence: readConfidence('failure_category', answer.confidence),
    probabilities: { ...answer.probabilities },
  };
}

function readChangeRelated(
  answers: Record<string, JevAnswer>,
): ChangeRelatedClassification {
  const answer = requireAnswer(answers, 'change_related');

  if (answer.type !== 'noul') {
    throw new Error(
      `Expected a "noul" answer for "change_related" but got a "${answer.type}" answer.`,
    );
  }

  // Keep the raw probability so callers can decide what it means.
  const { noul: probability } = answer;
  if (!(probability >= 0 && probability <= 1)) {
    throw new Error(
      `The "change_related" noul answer must be a probability between 0 and 1, got ${probability}.`,
    );
  }

  return { probability };
}

function readDiagnosticClarity(
  answers: Record<string, JevAnswer>,
): DiagnosticClarityClassification {
  const answer = requireAnswer(answers, 'diagnostic_clarity');

  if (answer.type !== 'score') {
    throw new Error(
      `Expected a "score" answer for "diagnostic_clarity" but got a "${answer.type}" answer.`,
    );
  }
  if (typeof answer.score !== 'number') {
    throw new Error(
      `The "diagnostic_clarity" score must be a number, got ${answer.score}.`,
    );
  }
  if (!(answer.score >= 0 && answer.score <= MAX_CLARITY_SCORE)) {
    throw new Error(
      `The "diagnostic_clarity" score must be between 0 and ${MAX_CLARITY_SCORE}, got ${answer.score}.`,
    );
  }

  return {
    score: answer.score,
    confidence: readConfidence('diagnostic_clarity', answer.confidence),
    probabilities: { ...answer.probabilities },
  };
}

function isFailureCategory(value: string): value is FailureCategory {
  return (FAILURE_CATEGORIES as string[]).includes(value);
}
