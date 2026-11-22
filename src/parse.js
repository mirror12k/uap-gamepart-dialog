// The dialog text format (pure, no state). A dialog is a text blob:
//
//   :start                          a node: its id after ':' (the first node, or one called `start`, opens the dialog)
//   Hello, traveler.                the node's text (any number of lines; blank lines keep paragraphs)
//   ! met_keeper                    set a flag when the node is entered ('! !name' clears it)
//   $open_door north                an ACTION: a named hook for the host, run when the node is entered (`name`, then an argument)
//   > Ask about the door -> door    a choice (option): label -> the node it leads to
//   > [met_keeper & !angry] Show the key -> open     only offered while the flag expression is true (see expr.js)
//   > [once] Ask again -> again     the magic flag `once`: picking this option sets a flag for good and it is never offered again
//   > Take the key -> done $give key     an option with an ACTION: `$name arg` at the end of the line (the name has to follow " $" directly)
//   > Leave                         no arrow: picking it ends the dialog
//   @ [met_keeper] -> met_before    a ROUTE: entering the node jumps straight to the first route whose condition holds
//   @ -> first_time                 (`@ -> node` always matches: put it last). `once` = this route was not taken before.
//   // a comment line
//
// Text before the first `:node` line belongs to the `start` node. The text is handed out untouched: markdown (or any markup) is
// the host's business.
import { parseExpr } from './expr.js';

// `[condition]` right after `>`, unless it is a span `[text]{...}` or a link `[text](...)` that starts the label
const CHOICE = /^>\s*(?:\[([^\]]*)\](?![{(])\s*)?(.*?)\s*(?:->\s*([\w.:-]*)\s*)?$/;
const ACTION_TAIL = /^(.*?)\s\$([A-Za-z_][\w.:-]*)(?:\s+(.*?))?\s*$/;
const ACTION_LINE = /^\$([A-Za-z_][\w.:-]*)(?:\s+(.*?))?\s*$/;

/**
 * Parse a dialog blob. Returns { nodes: {id: node}, order: [id], start, errors: [string], actions: [name] }.
 * node = { id, text, sets: [{flag, on}], actions: [{name, arg}], choices: [option], routes: [route] }
 * option = { index (1-based, stable: its position in the node's text), label, target|null, cond|null, action: {name, arg}|null }
 * route  = { index, target, cond|null }
 */
export function parseDialog(source) {
  const nodes = {}, order = [], errors = [], actionNames = new Set();
  let cur = null;
  const open = (id) => {
    if (nodes[id]) { errors.push(`node "${id}" is defined twice`); cur = nodes[id]; return; }
    cur = { id, lines: [], sets: [], actions: [], choices: [], routes: [], text: '' };
    nodes[id] = cur; order.push(id);
  };
  const checkExpr = (cond, what) => { if (cond !== null) { const e = parseExpr(cond).error; if (e) errors.push(`node "${cur.id}": ${what}: ${e}`); } };
  for (const raw of String(source || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*\/\//.test(line)) continue;
    const head = /^:\s*([\w.:-]+)\s*$/.exec(line);
    if (head) { open(head[1]); continue; }
    if (line.startsWith(':')) { errors.push(`bad node line "${line}"`); continue; }
    if (!cur) { if (!line.trim()) continue; open('start'); }
    if (line.startsWith('@')) {
      const m = /^@\s*(?:\[([^\]]*)\]\s*)?->\s*([\w.:-]+)\s*$/.exec(line);
      if (!m) { errors.push(`bad route "${line}"`); continue; }
      const cond = m[1] === undefined ? null : m[1].trim();
      checkExpr(cond, `route to "${m[2]}"`);
      cur.routes.push({ target: m[2], cond: cond || null, index: cur.routes.length + 1 });
    } else if (line.startsWith('>')) {
      let body = line, action = null;
      const at = ACTION_TAIL.exec(line);
      if (at) { body = at[1]; action = { name: at[2], arg: at[3] || '' }; }
      const m = CHOICE.exec(body);
      if (!m || !m[2]) { errors.push(`bad choice "${line}"`); continue; }
      const cond = m[1] === undefined ? null : m[1].trim();
      checkExpr(cond, `choice "${m[2]}"`);
      if (action) actionNames.add(action.name);
      cur.choices.push({ label: m[2], target: m[3] || null, cond: cond || null, index: cur.choices.length + 1, action });
    } else if (line.startsWith('!')) {
      const m = /^!\s*(!?)\s*([\w.:-]+)\s*$/.exec(line);
      if (!m) errors.push(`bad flag line "${line}"`); else cur.sets.push({ flag: m[2], on: m[1] !== '!' });
    } else if (ACTION_LINE.test(line)) {
      const m = ACTION_LINE.exec(line);
      actionNames.add(m[1]);
      cur.actions.push({ name: m[1], arg: m[2] || '' });
    } else cur.lines.push(line);
  }
  for (const id of order) {
    const n = nodes[id];
    n.text = n.lines.join('\n').replace(/^\n+|\n+$/g, '');
    delete n.lines;
    for (const c of n.choices) if (c.target && !nodes[c.target]) errors.push(`node "${id}": choice "${c.label}" leads to unknown node "${c.target}"`);
    for (const r of n.routes) if (!nodes[r.target]) errors.push(`node "${id}": route leads to unknown node "${r.target}"`);
  }
  return { nodes, order, start: nodes.start ? 'start' : order[0] || null, errors, actions: [...actionNames] };
}
