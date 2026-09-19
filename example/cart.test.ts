import { describe, expect, it } from 'vitest';

import { calculateTotal } from './cart.ts';

describe('calculateTotal', () => {
  it('calculates the total for multiple items', () => {
    expect(calculateTotal(1000, 3)).toBe(3000);
  });
});
