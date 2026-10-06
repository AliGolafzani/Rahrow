import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('AUTH-03 uses the approved transparent palette-corrected canonical logo bytes', async () => {
  const asset = await readFile(new globalThis.URL('../public/brand/rahrow-symbol.png', import.meta.url));
  assert.equal(createHash('sha256').update(asset).digest('hex'),
    '5c058b84e5aec8358ba6f0977d882c2cbf7bec84b89b176561483b6865f7cb24');
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(asset.readUInt32BE(16), 1114);
  assert.equal(asset.readUInt32BE(20), 1114);
});
