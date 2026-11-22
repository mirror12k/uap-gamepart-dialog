import test from 'node:test';
import assert from 'node:assert/strict';
import { Dialog, parseDialog } from '../src/index.js';

// the README's shop example and loop shape, headlessly
const shop = `:start
@ [talk.shop.bought & once] -> thanks
@ [talk.shop.greeting] -> welcome_back
@ -> greeting
:greeting
Welcome to my shop.
> [!has_gold] Browse -> browse
> Buy the lamp -> bought $buy lamp
:browse
Looking.
:welcome_back
Back again?
> Buy the lamp -> bought $buy lamp
> Leave
:bought
It's yours.
> Leave
:thanks
Thanks again for the lamp!
> Leave`;

test('README shop: a character who remembers you', () => {
  const flags = {}, bought = [];
  const run = () => {
    const d = new Dialog(shop, { flags, prefix: 'talk.shop', actions: { buy: (a) => bought.push(a.arg) } });
    assert.deepEqual(d.errors, []);
    d.start();
    return d;
  };
  let d = run();
  assert.equal(d.text, 'Welcome to my shop.');
  d.choose(1);                                              // Buy the lamp ([Browse] is option 0: no gold)
  assert.equal(d.text, "It's yours."); assert.equal(flags['talk.shop.bought'], true);
  d.choose(0);                                              // Leave
  assert.equal(d.ended, true);
  assert.deepEqual(bought, ['lamp']);
  d = run();
  assert.equal(d.text, 'Thanks again for the lamp!', 'the once route fires the first time after buying');
  d = run();
  assert.equal(d.text, 'Back again?');
});

test('README: validate actions against the hooks; one tree many speakers', () => {
  const tree = parseDialog(shop);
  assert.deepEqual(tree.actions, ['buy']);
  const flags = {};
  new Dialog(tree, { flags, prefix: 'talk.n' }).start();
  assert.equal(flags['talk.n.start.r3'], true);
  assert.equal(flags['talk.s.start.r3'], undefined);
});
