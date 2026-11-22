import test from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, parseExpr } from '../src/index.js';

test('flag expressions: ! & | ( ), && and ||, precedence, names with dots and dashes, malformed ones', () => {
  const f = { a: true, b: false, c: true, 'level.solved.tutorial-echo': true, 'difficulty.hard': true };
  const t = (src, want) => assert.equal(evalExpr(src, f), want, src);
  t('a', true); t('b', false); t('!a', false); t('!b', true); t('!!a', true);
  t('a & b', false); t('a & c', true); t('a | b', true); t('b | b', false); t('a && c', true); t('b || a', true);
  t('a | b & b', true); t('(a | b) & b', false); t('!(a & b)', true); t('!(a | b)', false);
  t('a & !b & c', true); t('  a   &   (  b |  c ) ', true);
  t('level.solved.tutorial-echo', true); t('!level.solved.tutorial-echo & difficulty.hard', false); t('level.solved.tutorial-echo & difficulty.hard', true);
  t('missing', false); t('!missing', true);
  assert.equal(evalExpr('x & y', (n) => n === 'x' || n === 'y'), true, 'a lookup function works too');
  for (const bad of ['', 'a &', '& a', '(a', 'a)', 'a b', 'a $ b', '()', '!']) {
    assert.ok(parseExpr(bad).error, `"${bad}" is rejected`);
    assert.equal(evalExpr(bad, f), false, 'a malformed expression is false');
  }
  assert.equal(parseExpr('a & b'), parseExpr('a & b'), 'compiled once');
});
