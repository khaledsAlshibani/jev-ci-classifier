export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  /**
   * Answer meanings, up to 255 options.
   */
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  /**
   * Optional descriptions for what true and false mean.
   * A Noul answer is the probability of true.
   */
  criteria?: Record<'true' | 'false', string>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  /**
   * Ordered descriptions from low to high.
   * A Score supports 2 to 10 levels.
   */
  criteria: readonly string[];
}

export type JevQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export type QuestionSet = Record<string, JevQuestion>;

/**
 * All three questions are evaluated independently from the same state.
 * classifier.ts combines their answers into one result.
 */
export const questions = {
  failure_category: {
    type: 'choice',
    instructions:
      'Identify the primary cause of this CI job failure. The job runs lint, then type checking, then the test suite, and stops at the first failing step.',
    criteria: {
      lint_failure: 'ESLint reported a rule violation.',
      type_failure:
        'The TypeScript compiler reported a type error or a syntax error.',
      test_failure:
        'A test assertion failed, or the test runner could not execute the suite.',
      dependency_failure:
        'A dependency could not be resolved or loaded while running the checks.',
      ci_environment_failure:
        'The runner, the network, or an external service failed, rather than the code under test.',
      unknown:
        'The available information is not enough to identify the primary cause.',
    },
  },
  change_related: {
    type: 'noul',
    instructions: 'The edits shown under change.diff caused this CI failure.',
    criteria: {
      true: 'The failure can reasonably be explained by the changes shown in change.diff, including indirect effects in unchanged files.',
      false:
        'The available evidence suggests the failure is unrelated to the changes shown in change.diff or was already present.',
    },
  },
  // Keep the levels mutually exclusive so the same log does not clearly fit more than one.
  diagnostic_clarity: {
    type: 'score',
    instructions:
      'How clearly does the captured output identify the cause of this CI failure?',
    criteria: [
      'The output only reports that a step failed without identifying a file, rule, assertion, or error location.',
      'The output identifies a file, rule, or assertion, but does not provide a line number or concrete mismatch.',
      'The output provides a line number or a concrete expected-versus-actual mismatch.',
    ],
  },
} satisfies QuestionSet;
