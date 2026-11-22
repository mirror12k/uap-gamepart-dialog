import test from 'node:test';
import assert from 'node:assert/strict';
import { Dialog } from '../src/index.js';

const labels = (d) => d.options.map((o) => o.label);

test('a conversation: text, options, choosing, ending; flags by reference', () => {
  const flags = {};
  const d = new Dialog(':start\nHello.\n! met\n> Ask -> ask\n> [met] Return -> back\n> [!met] Fresh -> ask\n> Bye\n:ask\nAnswer.\n! !met\n> Back -> start\n:back\nBack again.', { flags, prefix: 'talk.a' });
  assert.equal(d.hasContent, true);
  d.start();
  assert.equal(d.text, 'Hello.');
  assert.deepEqual(labels(d), ['Ask', 'Return', 'Bye']);
  assert.equal(flags.met, true, 'flag lines set the object'); assert.equal(flags['talk.a.start'], true, 'the node entered is recorded');
  d.choose(0);
  assert.equal(d.text, 'Answer.'); assert.equal(flags.met, undefined, '`! !name` clears'); assert.equal(flags['talk.a.start.1'], true, 'the pick is recorded');
  d.choose(0);
  assert.equal(d.text, 'Hello.'); assert.equal(d.ended, false);
  d.choose(d.options[2]);                                   // an option object works
  assert.equal(d.ended, true); assert.deepEqual(d.options, []);
  d.choose(0);                                              // harmless once ended
  assert.equal(d.ended, true);
});

test('terminal: a node with nothing to pick; the host decides how it ends', () => {
  const d = new Dialog(':a\nOnly text.').start();
  assert.equal(d.terminal, true); assert.equal(d.ended, false);
  d.close();
  assert.equal(d.ended, true); assert.equal(d.terminal, false);
});

test('flag adapters: object, lookup function (read only), {get,set}', () => {
  const src = ':a\n! x\n> [x] Seen -> a';
  const ro = new Dialog(src, { flags: (n) => n === 'x' }).start();
  assert.deepEqual(labels(ro), ['Seen'], 'a function supplies the flags');
  const store = new Map(); const sets = [];
  const ad = new Dialog(src, { flags: { get: (n) => store.get(n), set: (n, on) => store.set(n, on) }, onSet: (n, on) => sets.push([n, on]) }).start();
  assert.equal(store.get('x'), true); assert.deepEqual(labels(ad), ['Seen']);
  assert.deepEqual(sets, [['dialog.a', true], ['x', true]], 'onSet sees every flag the dialog sets');
});

test('once: an option is gone after it was picked, also in a new Dialog on the same flags', () => {
  const flags = {};
  const src = ':start\nHi.\n> [once] Ask -> start\n> [once & met] Ask more\n> Plain';
  const d = new Dialog(src, { flags }).start();
  assert.deepEqual(labels(d), ['Ask', 'Plain']);
  d.choose(0);
  assert.deepEqual(labels(d), ['Plain']);
  assert.deepEqual(labels(new Dialog(src, { flags }).start()), ['Plain'], 'progress lives in the flags');
  flags.met = true;
  assert.deepEqual(labels(new Dialog(src, { flags }).start()), ['Ask more', 'Plain']);
});

test('routes: entering a node jumps to the first route whose condition holds; once; chains; 20 hop limit', () => {
  const src = [':start', '@ [solved & once] -> congrats', '@ [met] -> again', '@ [once] -> first', '@ -> plain', 'never shown',
    ':first', 'Nice to meet you.', '! met', '> Ok -> start', ':again', 'Back again.', ':congrats', 'You solved it!', '> Thanks -> start', ':plain', 'Hello.'].join('\n');
  const flags = {};
  const d = new Dialog(src, { flags, prefix: 't' }).start();
  assert.equal(d.text, 'Nice to meet you.'); assert.equal(flags['t.start.r3'], true, 'the route taken is recorded'); assert.equal(flags['t.plain'], undefined);
  d.choose(0);
  assert.equal(d.text, 'Back again.');
  const solved = { solved: true };
  const s = new Dialog(src, { flags: solved, prefix: 't' }).start();
  assert.equal(s.text, 'You solved it!');
  s.choose(0);
  assert.equal(s.text, 'Nice to meet you.', 'the congrats route is spent');
  assert.equal(new Dialog(':start\n@ [nope] -> x\n@ -> plain\n:x\nX\n:plain\nPlain.').start().text, 'Plain.');
  const loop = new Dialog(':start\n@ -> start').start();            // must not hang
  assert.equal(loop.nodeId, 'start');
  assert.equal(new Dialog(':start\n@ [never] -> x\nOwn text.\n> Go -> x\n:x\nX').start().text, 'Own text.');
});

test('actions: `$name arg` on nodes and options run host hooks, in order, with the right context', () => {
  const log = [];
  const flags = {};
  const d = new Dialog(':start\nHi.\n$wave slow\n> Take it -> end $give key\n> Leave $bye\n:end\nDone.\n$unknown x', {
    flags,
    actions: { wave: (a) => log.push(['wave', a]), give: (a, dlg) => log.push(['give', a, dlg.flag('dialog.start.1')]) },
    onAction: (a) => log.push(['other', a.name, a.arg]),
    onNode: (n) => log.push(['node', n.id]),
    onEnd: () => log.push(['end']),
  });
  d.start();
  assert.deepEqual(log, [['wave', { name: 'wave', arg: 'slow', node: 'start', option: null }], ['node', 'start']]);
  log.length = 0;
  d.choose(0);
  assert.deepEqual(log, [['give', { name: 'give', arg: 'key', node: 'start', option: 1 }, true], ['other', 'unknown', 'x'], ['node', 'end']], 'the pick is recorded before the hook; the option action runs before the target is entered');
  log.length = 0;
  const e = new Dialog(':a\n> Leave $bye now', { onAction: (a) => log.push(a.name + ':' + a.arg), onEnd: () => log.push('end') }).start();
  e.choose(0);
  assert.deepEqual(log, ['bye:now', 'end'], 'an option without a target ends after its action');
});

test('a hook can steer: goto and close stop the default advance', () => {
  const d = new Dialog(':a\n> Go -> b $jump c\n:b\nB\n:c\nC', { actions: { jump: (a, dlg) => dlg.goto(a.arg) } }).start();
  d.choose(0);
  assert.equal(d.nodeId, 'c', 'the hook moved on: the option target (b) is not entered');
  const e = new Dialog(':a\n> Go -> b $stop\n:b\nB', { actions: { stop: (a, dlg) => dlg.close() } }).start();
  e.choose(0);
  assert.equal(e.ended, true);
});

test('unknown start, empty text, parsed trees, errors', () => {
  const empty = new Dialog('').start();
  assert.equal(empty.hasContent, false); assert.equal(empty.ended, true);
  const bad = new Dialog(':a\n> x -> nope');
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.start().choose(0).ended, true, 'a dead target ends the dialog instead of throwing');
});

test('text is returned untouched (markup is the host\'s job)', () => {
  const d = new Dialog(':a\n**Bold** and [red]{fg=danger}\n> *x* [y](z) -> a').start();
  assert.equal(d.text, '**Bold** and [red]{fg=danger}');
  assert.equal(d.options[0].label, '*x* [y](z)');
});
