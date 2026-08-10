import assert from 'node:assert';
import { sum } from './sum.mjs';

try {
  assert.strictEqual(sum(2, 3), 5);
  assert.strictEqual(sum(0, 0), 0);
  console.log('PASS: all sum tests passed');
} catch {
  console.error('FAIL: sum(2, 3) should equal 5');
  process.exit(1);
}
