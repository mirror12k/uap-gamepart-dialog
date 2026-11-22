// A running conversation: the parsed tree + a flags reference + hooks. No rendering, no engine: the host reads `text` and
// `options`, shows them however it likes (markdown, a canvas, a terminal ...) and calls `choose(i)`.
//
//   const talk = new Dialog(blob, { flags, prefix: 'talk.keeper', actions: { give: (a, d) => inventory.add(a.arg) } });
//   talk.start();                  // enters the start node (routes, flag lines and actions run)
//   talk.text                      // the node's text, untouched
//   talk.options                   // [{ index, label, target, cond, action }]: the options visible right now
//   talk.choose(0)                 // pick the first visible option (an option object works too)
//   talk.ended                     // true once an option without target was picked, or close() was called
//   talk.terminal                  // the current node offers nothing to pick (the host decides how that ends: a close button, Esc ...)
//
// FLAGS (`opts.flags`): a plain object {name: true} (read and written by the dialog), a function (name) => boolean (read only), or
// an adapter { get(name) => boolean, set(name, on) } for a host that keeps flags elsewhere (a save file, derived flags ...).
//
// PROGRESS is recorded as flags named `${prefix}.<node>` (the node was entered), `${prefix}.<node>.<n>` (its n-th option was
// picked) and `${prefix}.<node>.r<n>` (its n-th route was taken). The magic name `once` in a condition is true until the
// option (or route) it sits on was picked (taken) - so progress survives with the flags and the host needs no extra state.
//
// HOOKS (all optional, `opts`):
//   actions: { name: (action, dialog) => void }   run for `$name arg` lines/suffixes; action = { name, arg, node, option }
//   onAction(action, dialog)                      for actions without an entry in `actions`
//   onNode(node, dialog)                          after a node was entered (flags set, actions run)
//   onEnd(dialog)                                 when the dialog ended
//   onSet(name, on, dialog)                       whenever the dialog sets a flag (progress records included)
// A hook may call dialog.goto(id) (jump to a node) or dialog.close(); choose() then does not advance on its own.
import { parseDialog } from './parse.js';
import { evalExpr } from './expr.js';

const MAX_HOPS = 20;

function adaptFlags(f) {
  if (typeof f === 'function') return { get: (n) => !!f(n), set() {} };
  if (f && typeof f.get === 'function') return { get: (n) => !!f.get(n), set: (n, on) => { if (f.set) f.set(n, on); } };
  const o = f || {};
  return { get: (n) => !!o[n], set: (n, on) => { if (on) o[n] = true; else delete o[n]; } };
}

export class Dialog {
  /** @param source a dialog text, or an already parsed tree (parseDialog's result) */
  constructor(source, opts = {}) {
    this.tree = typeof source === 'string' || source == null ? parseDialog(source) : source;
    this.prefix = opts.prefix === undefined ? 'dialog' : opts.prefix;
    this.opts = opts;
    this._flags = adaptFlags(opts.flags);
    this.nodeId = null;
    this.ended = false;
    this.started = false;
  }

  /** Problems found while parsing (unknown nodes, bad conditions ...): strings. */
  get errors() { return this.tree.errors; }
  /** False when the text holds no node at all (nothing to say). */
  get hasContent() { return !!this.tree.start; }
  get node() { return this.nodeId ? this.tree.nodes[this.nodeId] : null; }
  get text() { return this.node ? this.node.text : ''; }
  /** The options the player can pick right now (conditions evaluated against the current flags). */
  get options() {
    const n = this.node;
    if (!n || this.ended) return [];
    return n.choices.filter((c) => !c.cond || this._eval(c.cond, this._record(n.id, c.index)));
  }
  get terminal() { return !this.ended && this.started && this.options.length === 0; }

  flag(name) { return this._flags.get(name); }
  setFlag(name, on = true) { this._flags.set(name, !!on); if (this.opts.onSet) this.opts.onSet(name, !!on, this); }

  /** Enter a node (default: the tree's start). Routes are followed first; then flag lines and actions run. */
  start(entry) { return this.goto(entry || this.tree.start); }

  goto(id) {
    this.ended = false;
    this.started = true;
    let hops = 0;
    for (; hops < MAX_HOPS; hops++) {
      const n = this.tree.nodes[id];
      const r = n && n.routes.find((x) => !x.cond || this._eval(x.cond, this._record(id, `r${x.index}`)));
      if (!r) break;
      this.setFlag(this._record(id, `r${r.index}`), true);
      id = r.target;
    }
    const node = this.tree.nodes[id];
    if (!node) { this.nodeId = null; this.close(); return this; }
    this.nodeId = id;
    this.setFlag(this._record(id), true);
    for (const s of node.sets) this.setFlag(s.flag, s.on);
    for (const a of node.actions) { this._run(a, id, null); if (this.nodeId !== id || this.ended) return this; }
    if (this.opts.onNode) this.opts.onNode(node, this);
    return this;
  }

  /** Pick an option: its position in `options` (or the option itself). Records it, runs its action, then follows its target. */
  choose(which) {
    const opts = this.options;
    const opt = typeof which === 'number' ? opts[which] : opts.find((o) => o === which);
    if (!opt) return this;
    const from = this.nodeId;
    this.setFlag(this._record(from, opt.index), true);
    if (opt.action) {
      this._run(opt.action, from, opt.index);
      if (this.ended || this.nodeId !== from) return this;       // the hook moved the conversation itself
    }
    if (opt.target) this.goto(opt.target); else this.close();
    return this;
  }

  close() {
    if (this.ended) return this;
    this.ended = true;
    if (this.opts.onEnd) this.opts.onEnd(this);
    return this;
  }

  // ------------------------------------------------------------------ internals
  _record(node, sub) { return `${this.prefix}.${node}${sub === undefined ? '' : `.${sub}`}`; }

  _eval(cond, onceFlag) {
    return evalExpr(cond, (n) => (n === 'once' ? !this._flags.get(onceFlag) : this._flags.get(n)));
  }

  _run(a, node, option) {
    const action = { name: a.name, arg: a.arg, node, option };
    const fn = this.opts.actions && this.opts.actions[a.name];
    if (fn) fn(action, this); else if (this.opts.onAction) this.opts.onAction(action, this);
  }
}
