import test from 'node:test';
import assert from 'node:assert/strict';
import * as src from '../src/index.js';
import * as bundle from '../dist/uap-dialog.js';

test('the single-file bundle exports the same API and works', () => {
  assert.deepEqual(Object.keys(bundle).sort(), Object.keys(src).sort());
  const d = new bundle.Dialog(':a\nHi\n> Go -> b\n:b\nThere').start();
  d.choose(0);
  assert.equal(d.text, 'There');
  assert.equal(bundle.evalExpr('a & !b', { a: true }), true);
});
