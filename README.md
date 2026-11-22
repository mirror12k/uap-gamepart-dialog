# uap-dialog

Flag-driven dialog trees for games. **Zero dependencies, no rendering, no engine, no DOM.**

You write conversations in a small text format. At runtime a `Dialog` object tells your game what the character says, which
options the player can pick right now, and calls your hooks when something should happen in the game. Everything the player does
is recorded as plain boolean *flags* in a place you control (your save file), so conversations remember what happened and other
systems can react to it.

What it deliberately does **not** do: draw anything, and interpret the text. Dialog text and option labels come back exactly as
written, so markdown, colour codes, localisation keys or plain text are all fine: that is the host's business.

- [Quick start](#quick-start)
- [A complete loop](#a-complete-loop-copy-this) (terminal, copy and adapt)
- [The text format](#the-text-format) (nodes, options, flags, conditions, `once`, routes, actions)
- [Flags](#flags)
- [Hooks: reacting in the game](#hooks-reacting-in-the-game)
- [API reference](#api-reference)
- [Patterns and recipes](#patterns-and-recipes)
- [Build, test, vendoring](#build-test-vendoring)

## Quick start

```js
import { Dialog } from 'uap-dialog';

const flags = {};                                   // your game's flags: {name: true}
const talk = new Dialog(`
:start
Hello, traveler.
> Who are you? -> who
> Goodbye

:who
Just the keeper of this place.
> Back -> start
`, { flags });

talk.start();
talk.text;            // 'Hello, traveler.'
talk.options;         // [{ label: 'Who are you?', target: 'who', ... }, { label: 'Goodbye', target: null, ... }]
talk.choose(0);       // pick the first visible option
talk.text;            // 'Just the keeper of this place.'
```

The dialog is a plain state machine: **read** `text` and `options`, show them, **call** `choose(i)` when the player picks, repeat
until `ended`.

## A complete loop (copy this)

A runnable terminal version of the loop every host writes. Replace `console.log` and `readline` with your UI (a canvas, DOM
buttons, an engine's menu widget ...); the shape stays the same.

```js
import readline from 'node:readline/promises';
import { Dialog } from 'uap-dialog';

const flags = {};                                    // the game's flags: the dialog reads and writes them
const inventory = new Set();

const talk = new Dialog(blobText, {
  flags,
  prefix: 'talk.keeper',                             // progress is recorded under this name
  actions: {
    give: (action) => { inventory.add(action.arg); console.log(`(you receive: ${action.arg})`); },
  },
  onAction: (action) => console.log(`(unhandled action ${action.name} ${action.arg})`),
});

if (talk.errors.length) console.warn('dialog problems:', talk.errors);   // always worth showing to the author
if (talk.hasContent) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  talk.start();                                      // enters the start node: routes, flag lines and node actions run
  while (!talk.ended) {
    console.log(`\n${talk.text}`);                   // 1. what is said (untouched text: render it however you like)
    const options = talk.options;                    // 2. what can be picked right now
    if (options.length === 0) { talk.close(); break; }          //    a node with nothing to pick: end (or wait for a key, host's choice)
    options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
    const n = Number(await rl.question('> ')) - 1;
    if (options[n]) talk.choose(n);                  // 3. pick: records it, runs its action, enters the target (or ends)
  }
  rl.close();
}
```

Notes for a graphical host: re-read `talk.options` after *every* change (flags can change between nodes and `once` options
disappear after they were picked); the `options` array is a fresh snapshot each time. `terminal` is `true` when the current node
offers nothing to pick, so a UI can show "press a key to close" instead of an empty list.

## The text format

A dialog is a text blob made of lines. A line's first character decides what it is.

```
// a comment line (ignored)
:start                          a node: ':' + its id (letters, digits, _ . : -)
Hello, traveler.                the node's text: any number of lines, blank lines are kept as paragraphs
! met_keeper                    set a flag when the node is entered ('! !name' clears it)
$wave slow                      an action: the host hook `wave` runs on entry, with the argument "slow"
> Who are you? -> who           an option: label, then '->' and the node it leads to
> Leave                         an option without '->': picking it ends the dialog
@ [met_keeper] -> met_before    a route (see below)
```

Text before the first `:node` line belongs to a node called `start`. The conversation opens at the node called `start`, or at the
first node if there is none. Node ids are unique.

### Nodes and text

```
:start
The door is **locked**.
Something glows behind it.

A second paragraph.
> Knock -> knock
```

`talk.text` is `'The door is **locked**.\nSomething glows behind it.\n\nA second paragraph.'`: leading and trailing blank lines are
trimmed, everything else is kept verbatim.

### Options and conditions

```
> Open the door -> inside
> [has_key] Use the key -> unlocked
> [has_key & !alarm | admin] Slip past the guard -> sneak
> [(met_a | met_b) & !angry] Ask about the plan -> plan
```

An option in `[brackets]` is offered only while the **flag expression** is true. Expressions use flag names and:

| | |
|---|---|
| `a` | true while flag `a` is set |
| `!a` | not |
| `a & b` or `a && b` | and |
| `a \| b` or `a \|\| b` | or (`&` binds tighter than `\|`) |
| `( ... )` | grouping |

Flag names use letters, digits and `_ . : -`, so structured names such as `level.solved.intro` or `difficulty.hard` work. A
malformed expression is false and shows up in `talk.errors`. An option that *starts* with a markdown span (`[text]{...}` or
`[text](...)`) is not mistaken for a condition: a `[...]` directly followed by `{` or `(` is part of the label.

### `once`: options that disappear

```
> [once] Ask about the weather -> weather
> [once & met] Ask again, politely -> polite
```

`once` is a magic name: true until the option has been picked, then false forever (it is stored in the flags, so it survives a
reload of the save). Combine it with other conditions freely.

### Flag lines

```
:accept
You take the job.
! job_accepted
! !job_offered
```

Flag lines run when the node is entered. `! name` sets, `! !name` clears.

### Routes: choosing where a conversation starts

```
:start
@ [quest_done & once] -> congratulate
@ [met]               -> welcome_back
@ [once]              -> first_time
@ -> plain
```

When a node is entered, the **first** route whose condition holds sends the player straight to its target: nothing of the routing
node is shown, and its own flag lines don't run. `@ -> node` always matches, so put it last. `once` in a route means "this route
hasn't been taken before". Routes can chain (at most 20 hops). Use them on `:start` so the same character opens differently
depending on the flags, and on any node that should skip ahead.

A node with no matching route behaves normally, so this works too:

```
:start
@ [angry] -> refuses
Good morning.
> Chat -> chat
```

### Actions: triggering game events

```
:start
$ambient rain                     node action: runs when the node is entered
Take this.
> Accept the sword -> thanks $give sword
> Refuse $emote shrug
> Pay [the toll]{fg=ok} -> gate $pay 5
```

`$name arg` as its own line is a **node action**. ` $name arg` at the **end of an option line** is an **option action**: it runs
when the option is picked (the pick is recorded first, then the action, then the target node is entered; an option without a
target ends the dialog after its action). `name` starts with a letter or `_`; the argument is the rest of the line (it may be
empty). In an option label, write ` $word` only when you mean an action: `$5` (a digit) is ordinary text.

## Flags

The dialog reads and writes your flags through `opts.flags`. Three shapes are accepted:

```js
// 1. a plain object {name: true}: read and written by the dialog (cleared flags are deleted)
const flags = { has_key: true };
new Dialog(blob, { flags });

// 2. a function (name) => boolean: read-only (flag lines and progress records are silently not stored)
new Dialog(blob, { flags: (name) => name === 'has_key' });

// 3. an adapter, for flags that live elsewhere (a save file, a store, derived flags ...)
new Dialog(blob, {
  flags: {
    get: (name) => save.flag(name),
    set: (name, on) => save.setFlag(name, on),       // autosave, update the world, ...
  },
});
```

### What gets recorded

The dialog records progress as flags, named from `opts.prefix` (default `dialog`), so the same character can be told apart from
another (use something unique per conversation, e.g. `talk.<room>.<npc>`):

| flag | meaning |
|---|---|
| `<prefix>.<node>` | the node was entered |
| `<prefix>.<node>.<n>` | the node's n-th option (1-based, its position in the text) was picked |
| `<prefix>.<node>.r<n>` | the node's n-th route was taken |

Options and routes are numbered by their **position in the node's text**, not by what is visible, so the numbers are stable even
when conditions hide some options. Other systems can use these flags: a door can open `showIf talk.keeper.give_key`, another
dialog can say `> [talk.keeper.who] I met the keeper`. `once` is simply "the matching `.<n>` / `.r<n>` flag is not set yet".

## Hooks: reacting in the game

All hooks are optional and passed in the options object.

| option | called | arguments |
|---|---|---|
| `actions: { name: fn }` | for `$name arg` actions that have an entry | `(action, dialog)` |
| `onAction(action, dialog)` | for actions without an entry in `actions` | |
| `onNode(node, dialog)` | after a node was entered (flags set, node actions run) | |
| `onEnd(dialog)` | once, when the dialog ends | |
| `onSet(name, on, dialog)` | whenever the dialog sets or clears a flag (progress records included) | |

`action` is `{ name, arg, node, option }`: `node` is the id of the node it ran in and `option` is the option's 1-based number, or
`null` for a node action.

A hook may steer the conversation: calling `dialog.goto(id)` jumps to a node, `dialog.close()` ends it. When a hook of an
**option** action does either, `choose()` does not additionally follow the option's own target.

```js
const talk = new Dialog(blob, {
  flags,
  actions: {
    give:  (a)    => player.inventory.add(a.arg),
    pay:   (a, d) => { if (!player.pay(Number(a.arg))) d.goto('too_poor'); },   // refuse: jump instead of the option's target
    fight: (a, d) => { d.close(); battle.start(a.arg); },                       // leave the conversation
  },
  onSet: (name, on) => console.log('flag', name, on),
  onEnd: () => ui.closeDialogWindow(),
});
```

## API reference

```js
import { Dialog, parseDialog, evalExpr, parseExpr } from 'uap-dialog';
```

### `new Dialog(source, opts)`

`source` is the dialog text, or the result of `parseDialog` (to parse once and reuse it for many conversations). `opts`: `flags`,
`prefix`, and the hooks above.

| member | |
|---|---|
| `start(entry?)` | enter the start node (or node `entry`): routes are followed, then the node's flag lines and actions run. Returns the dialog. |
| `goto(id)` | enter a node the same way (for hooks). An unknown id ends the dialog. |
| `text` | the current node's text, untouched (`''` when there is none) |
| `options` | the options visible **right now**: `[{ index, label, target, cond, action }]` (`index` is the stable 1-based number, `target` is `null` for "ends the dialog", `action` is `{name, arg}` or `null`). Empty when ended. |
| `choose(which)` | pick an option: its position in `options`, or the option object. Records the pick, runs its action, follows its target (or ends). Anything else is ignored. Returns the dialog. |
| `close()` | end the dialog (calls `onEnd` once) |
| `ended` | the dialog ended (an option without target was picked, a hook closed it, or the start was missing) |
| `terminal` | started, not ended, and the current node offers nothing to pick |
| `node`, `nodeId` | the current parsed node / its id |
| `errors` | parse problems: unknown nodes, bad conditions, malformed lines (strings; show them to the author) |
| `hasContent` | the text contained at least one node |
| `flag(name)`, `setFlag(name, on)` | access to the flags through the same adapter (setFlag also calls `onSet`) |
| `tree` | the parsed tree |

### `parseDialog(text)`

Pure parsing, no state: `{ nodes, order, start, errors, actions }`. A node is `{ id, text, sets: [{flag, on}], actions: [{name,
arg}], choices: [option], routes: [{index, target, cond}] }`; `actions` (top level) lists every action name used, handy to
validate a dialog against the hooks your game has:

```js
const tree = parseDialog(blob);
const unknown = tree.actions.filter((n) => !(n in myActions));
```

### `parseExpr(src)` and `evalExpr(src, flags)`

The flag-expression engine on its own (useful for any "show this if ..." rule in your game). `evalExpr('a & !b', flags)` takes an
object or a lookup function and returns a boolean; a malformed expression is `false`. `parseExpr(src)` returns the cached
`{ fn, error }` (`error` is a message or `null`).

## Patterns and recipes

**Validate every dialog at load time** and surface the problems to whoever wrote them:

```js
for (const [id, blob] of Object.entries(allDialogs)) {
  const t = parseDialog(blob);
  for (const e of t.errors) console.warn(`${id}: ${e}`);
  for (const a of t.actions) if (!(a in actions)) console.warn(`${id}: unknown action "${a}"`);
}
```

**One tree, many speakers:** parse once, build a `Dialog` per conversation with a different `prefix`:

```js
const tree = parseDialog(blob);
const a = new Dialog(tree, { flags, prefix: 'talk.guard.north' });
const b = new Dialog(tree, { flags, prefix: 'talk.guard.south' });   // remembers separately
```

**A character who remembers you:**

```
:start
@ [talk.shop.bought & once] -> thanks
@ [talk.shop.greeting] -> welcome_back
@ -> greeting
:greeting
Welcome to my shop.
> [!has_gold] Browse -> browse
> Buy the lamp -> bought $buy lamp
:welcome_back
Back again?
> Buy the lamp -> bought $buy lamp
> Leave
:bought
It's yours.
> Leave
:thanks
Thanks again for the lamp!
> Leave
```

(with `prefix: 'talk.shop'`: entering `:greeting` sets `talk.shop.greeting`, entering `:bought` sets `talk.shop.bought`. A routing node such as `:start` is never "entered" for recording: only its `.r<n>` route flags are set.)

**Gate a choice on game state the dialog doesn't own:** put it in the flags. Derive flags in your adapter (`get: (n) =>
n.startsWith('difficulty.') ? settings.difficulty === n.slice(11) : save.flag(n)`) and use them as conditions.

**Long dialogs:** keep them in `.txt` files and load them however your build likes (a bundler's text loader, `fs.readFileSync`, a
`fetch`): the library only ever sees the string.

**Rendering choices as markdown:** since text and labels are untouched, a host that renders markdown can print
`► [${o.label}](choice:${i})` links and call `choose(i)` from the link handler.

## Build, test, vendoring

```
docker/run npm test            # builds dist/uap-dialog.js, then runs the tests against the sources and the bundle
docker/run npm run build       # just the bundle
```

`dist/uap-dialog.js` is one self-contained ES module with no imports (the exports above), made to be copied into a host project
(a "vendored" file). Host projects that vendor it note the source commit alongside the copy. A GitHub workflow
(`.github/workflows/build.yml`) builds and tests on every push and keeps the bundle as a one-day artifact only; releases will
be published to npm later. As a package it exposes `src/index.js` (`import ... from 'uap-dialog'`) and `uap-dialog/bundle`.
