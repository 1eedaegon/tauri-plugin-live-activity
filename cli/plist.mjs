// Just enough of XML property lists to set one Boolean key of the root dictionary.

const TAG = /<(\/?)([A-Za-z]+)[^>]*?(\/?)>/g;

/** A new plist whose root dictionary holds `key` = true. */
export function newPlist(key) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>${key}</key>
\t<true/>
</dict>
</plist>
`;
}

/** Comments become spaces of the same length, so that positions still match the original text. */
function blankComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));
}

/** Where the root dictionary opens and closes, and the value tag of each key at its top level. */
function scanRoot(scan) {
  const plist = scan.indexOf('<plist');
  if (plist === -1) return undefined;
  const tags = [...scan.slice(plist).matchAll(TAG)].map(match => ({
    index: plist + match.index, end: plist + match.index + match[0].length,
    closing: match[1] === '/', name: match[2], empty: match[3] === '/',
  }));
  const root = tags.find(tag => tag.name !== 'plist');
  if (root?.name !== 'dict' || root.closing) return undefined;
  if (root.empty) return { root, close: undefined, keys: new Map() };
  return { root, ...rootEntries(scan, tags.slice(tags.indexOf(root) + 1)) };
}

function rootEntries(scan, tags) {
  const keys = new Map();
  let depth = 0;
  let pendingKey;
  for (const tag of tags) {
    if (depth === 0 && tag.closing && tag.name === 'dict') return { close: tag, keys };
    if (depth === 0 && !tag.closing && tag.name === 'key') {
      pendingKey = scan.slice(tag.end, scan.indexOf('</key>', tag.end)).trim();
    } else if (depth === 0 && !tag.closing && pendingKey !== undefined) {
      keys.set(pendingKey, tag);
      pendingKey = undefined;
    }
    if ((tag.name === 'dict' || tag.name === 'array') && !tag.empty) depth += tag.closing ? -1 : 1;
  }
  return { close: undefined, keys };
}

/**
 * Inserts the entry before the root's `</dict>`: on its own line when that tag starts a line, indented
 * like the first key of the root (`afterRoot` is the text after the root's opening tag).
 */
function insertEntry(text, afterRoot, close, key) {
  const lineStart = text.lastIndexOf('\n', close.index - 1) + 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, close.index))) {
    return `${text.slice(0, close.index)}<key>${key}</key><true/>${text.slice(close.index)}`;
  }
  const indent = afterRoot.match(/\n([ \t]*)<key>/)?.[1] || '\t';
  return `${text.slice(0, lineStart)}${indent}<key>${key}</key>\n${indent}<true/>\n${text.slice(lineStart)}`;
}

/**
 * Makes `key` true in the root dictionary of an XML plist. Status: `present` (already true), `added`
 * (with the new `text`), `false` or `other` (the key has another value, left as it is) or `unreadable`.
 */
export function setTrueKey(text, key) {
  const scan = blankComments(text);
  const root = scanRoot(scan);
  if (!root) return { status: 'unreadable' };
  const value = root.keys.get(key);
  if (value) return { status: value.name === 'true' ? 'present' : value.name === 'false' ? 'false' : 'other' };
  if (root.root.empty) {
    const opened = `<dict>\n\t<key>${key}</key>\n\t<true/>\n</dict>`;
    return { status: 'added', text: text.slice(0, root.root.index) + opened + text.slice(root.root.end) };
  }
  if (!root.close) return { status: 'unreadable' };
  return { status: 'added', text: insertEntry(text, scan.slice(root.root.end), root.close, key) };
}
