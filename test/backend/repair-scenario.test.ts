import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { repairScenario } from '../../backend/repair-scenario.js';

test('the model follows the reported fixture, damage, and safety assessment', () => {
  assert.equal(repairScenario('leak', 'bucket', 'Water drips from the ceiling'), 'ceiling-leak');
  assert.equal(repairScenario('leak', 'bucket', 'Water drips under the kitchen sink'), 'sink-leak');
  assert.equal(repairScenario('leak', 'towel', 'Small puddle on the floor'), 'floor-spill');
  assert.equal(repairScenario('damage', 'clear', 'Broken stair tread'), 'damaged-stair');
  assert.equal(repairScenario('damage', 'clear', 'Loose window latch'), 'damaged-window');
  assert.equal(repairScenario('leak', 'bucket', 'Water stain in the warehouse', 'Warehouse ceiling'), 'ceiling-leak');
  assert.equal(repairScenario('leak', 'bucket', 'Water drips under the kitchen sink', 'Warehouse ceiling'), 'sink-leak');
  assert.equal(repairScenario('damage', 'clear'), 'general-damage');
});
