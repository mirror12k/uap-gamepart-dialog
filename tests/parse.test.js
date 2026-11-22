import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDialog } from '../src/index.js';

test('nodes, text, flag lines, conditional choices, endings', () => {
  const d = parseDialog([
    '// comment', ':start', 'Hello.', '', 'Second paragraph.', '! met', '> Ask -> ask', '> [met] Return -> back', '> [!met] Fresh -> ask', '> Bye',
    ':ask', 'Answer.', '! !met', '> Back -> start', ':back', 'Back again.',
  ].join('\n'));
  assert.deepEqual(d.errors, []);
  assert.equal(d.start, 'start'); assert.deepEqual(d.order, ['start', 'ask', 'back']);
  assert.equal(d.nodes.start.text, 'Hello.\n\nSecond paragraph.');
  assert.deepEqual(d.nodes.start.sets, [{ flag: 'met', on: true }]); assert.deepEqual(d.nodes.ask.sets, [{ flag: 'met', on: false }]);
  assert.deepEqual(d.nodes.start.choices.map((c) => [c.label, c.target, c.index]), [['Ask', 'ask', 1], ['Return', 'back', 2], ['Fresh', 'ask', 3], ['Bye', null, 4]]);
  assert.deepEqual(d.nodes.back.choices, []);
  const implicit = parseDialog('Just text\n> Ok');
  assert.deepEqual([implicit.start, implicit.nodes.start.text, implicit.nodes.start.choices[0].label], ['start', 'Just text', 'Ok']);
  assert.equal(parseDialog(':first\nA\n:second\nB').start, 'first');
  assert.equal(parseDialog('').start, null);
  assert.equal(parseDialog(null).start, null);
});

test('problems are reported, not thrown', () => {
  const bad = parseDialog(':a\nx\n> go -> nowhere\n:a\n> \n! \n:\n');
  assert.ok(bad.errors.some((e) => /unknown node "nowhere"/.test(e)) && bad.errors.some((e) => /defined twice/.test(e)) && bad.errors.some((e) => /bad choice/.test(e)));
  assert.ok(bad.errors.some((e) => /bad flag/.test(e)) && bad.errors.some((e) => /bad node line/.test(e)));
  const expr = parseDialog(':a\nx\n> [a &] Oops\n> [] Empty\n> [(a] Paren');
  assert.equal(expr.errors.filter((e) => /choice/.test(e)).length, 3);
  const routes = parseDialog(':a\n@ [x &] -> a\n@ -> nowhere\n@ nonsense');
  assert.ok(routes.errors.some((e) => /route to "a"/.test(e)) && routes.errors.some((e) => /unknown node "nowhere"/.test(e)) && routes.errors.some((e) => /bad route/.test(e)));
});

test('conditions, once, routes and actions are parsed', () => {
  const d = parseDialog([':start', '@ [solved & once] -> x', '@ -> y', 'Hi.', '$wave slow', '> [met & !angry | vip] Secret -> x', '> [once] Ask -> start', '> Take it -> x $give key', '> [Green]{fg=ok} span -> x', '> [a](http://l) link -> x', ':x', 'X', ':y', 'Y'].join('\n'));
  assert.deepEqual(d.errors, []);
  const c = d.nodes.start.choices;
  assert.deepEqual(c.map((o) => [o.label, o.cond]), [['Secret', 'met & !angry | vip'], ['Ask', 'once'], ['Take it', null], ['[Green]{fg=ok} span', null], ['[a](http://l) link', null]], 'a leading span/link is text, not a condition');
  assert.deepEqual(c[2].action, { name: 'give', arg: 'key' });
  assert.equal(c[2].target, 'x');
  assert.deepEqual(d.nodes.start.actions, [{ name: 'wave', arg: 'slow' }]);
  assert.deepEqual(d.nodes.start.routes.map((r) => [r.cond, r.target, r.index]), [['solved & once', 'x', 1], [null, 'y', 2]]);
  assert.deepEqual(d.actions.sort(), ['give', 'wave']);
  assert.equal(parseDialog(':a\n$5 please\n> Costs $5 -> a').nodes.a.text, '$5 please', '$ + digit is plain text');
});
