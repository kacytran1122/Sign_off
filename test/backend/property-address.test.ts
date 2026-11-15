import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { belongsToProperty, suggestPropertyAddress } from '../../backend/repair.js';

const property = '12345-12349 Kensington Rd, Houston, TX 77054';

test('confirmed property comparison keeps the full house number and checks a supplied ZIP', () => {
  assert.ok(belongsToProperty('12347 Kensington Road, Houston, TX 77054-9999', property));
  assert.ok(belongsToProperty('12347 Kensington Rd, Houston, TX', property));
  assert.ok(!belongsToProperty('12347 Kensington Rd, Houston, TX 77045', property));
  assert.ok(!belongsToProperty('54321 Kensington Rd, Houston, TX 77054', property));
  assert.ok(!belongsToProperty('65432 Kensington Rd, Houston, TX', '12345 Kensington Rd, Houston, TX'));
});

test('one near address match can be suggested, but does not qualify as a property match', () => {
  for (const address of [
    '12347 Kensnigton Rd, Houston, TX 77054',
    '12347 Kensingtn Rd, Houston, TX',
    '12347 Kensingtonn Rd, Houston, TX 77054',
    '12347 Kensington Rd, Huston, TX 77054',
    '12347 Kensington Rd, Houston, TX 77045',
  ]) {
    assert.equal(suggestPropertyAddress(address, property), property);
    assert.ok(!belongsToProperty(address, property));
  }
});

test('address suggestion rejects a conflicting number, state, or multiple edits', () => {
  for (const address of [
    '12346 Kensington Rd, Houston, TN 77054',
    '12341 Kensnigton Rd, Houston, TX 77054',
    '12347 Kensingtn Rd, Huston, TX 77054',
    '12347 Kensnigton Rd, Houston, TX 77045',
    '12347 Kensington Rd, Houston, TX 76045',
    '12347 Colonial Rd, Houston, TX 77054',
  ]) {
    assert.equal(suggestPropertyAddress(address, property), undefined);
  }
  assert.equal(suggestPropertyAddress('12347 Kensington Rd, Houston, TX 77054', property), undefined);
});
