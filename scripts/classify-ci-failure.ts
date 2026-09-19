import { readFileSync } from 'node:fs';

import { classifyCIFailure } from '../src/classifier.ts';
import type { JevState } from '../src/openrouter.ts';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  fail(
    'OPENROUTER_API_KEY is not set. Copy .env.example to .env.local and add a key.',
  );
}

const [statePath] = process.argv.slice(2);

try {
  const state = loadState(statePath);
  const result = await classifyCIFailure(apiKey, state);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Print only the message because this output is also used in the PR summary.
  fail(error instanceof Error ? error.message : String(error));
}

/**
 * Loads the failure context from a JSON file, or from stdin.
 */
function loadState(path: string | undefined): JevState {
  const source = path ?? 'stdin';
  const raw =
    path === undefined ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The failure state in ${source} is not valid JSON.`);
  }

  // Validate the state locally before sending it to Jev.
  if (
    typeof parsed !== 'string' &&
    (typeof parsed !== 'object' || parsed === null)
  ) {
    throw new Error(
      `The failure state in ${source} must be a string, an object, or an array.`,
    );
  }

  return parsed as JevState;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
