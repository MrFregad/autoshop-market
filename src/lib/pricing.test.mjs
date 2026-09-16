// node src/lib/pricing.test.mjs
// Самопроверка правил ценообразования. Живёт отдельно от pricing.js:
// сам модуль грузится в браузере, где нет ни process, ни node:assert.
import { strict as assert } from 'node:assert';
import { calculatePrice, isBelowFloor } from './pricing.js';

assert.equal(calculatePrice(250).price, 449);     // тир 1: ×1.80
assert.equal(calculatePrice(600).price, 929);     // тир 2: ×1.55 (930 → 929)
assert.equal(calculatePrice(1500).price, 2090);   // тир 3: ×1.40
assert.equal(calculatePrice(3500).price, 4490);   // тир 4: ×1.28
assert.equal(calculatePrice(9000).price, 10900);  // тир 5: ×1.21
assert.equal(calculatePrice(25000).price, 28500); // тир 6: ×1.14
assert.equal(calculatePrice(90000).price, 98100); // тир 7: ×1.09
assert.equal(calculatePrice(100).price, 249);     // дрібниця: працює +150 грн, а не ×1.8
assert.equal(calculatePrice(250).oldPrice, 549);  // «стара ціна» лише на тирах 1-3
assert.equal(calculatePrice(3500).oldPrice, null);
assert.equal(calculatePrice(9000).needsMarketCheck, true);
assert.equal(calculatePrice(900).needsMarketCheck, false);
assert.equal(isBelowFloor(1000, 1200), true);     // +200 < 350 на тирі 3
assert.equal(isBelowFloor(1000, 1400), false);
assert.throws(() => calculatePrice(0));

console.log('pricing: ok');
