'use strict';
// Source-level regression: journey hides the cosmic HUD without changing normal cosmic visibility.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = template.match(/<style>([\s\S]*?)<\/style>/);
assert.ok(css, 'template style missing');
const hidden = Array.from(css[1].matchAll(/([^{}]+)\{([^{}]*)\}/g))
  .find(m => m[1].includes('body.journey #cosmoHud'));
assert.ok(hidden, 'journey HUD selector missing');
assert.match(hidden[1], /body\.journey\s+#atlasBtn/);
assert.match(css[1], /body\.journey\s+#atlasBtn\s*\{\s*transition\s*:\s*none\s*!important\s*;\s*\}/);
assert.match(css[1], /body:not\(\.journey\)\s+#atlasBtn\s*\{\s*transition\s*:\s*background\s+\.16s,\s*border-color\s+\.16s,\s*color\s+\.16s\s*;\s*\}/);
assert.match(css[1], /body:not\(\.journey\)\s+#atlasBtn:focus-within\s*\{\s*transition\s*:\s*none\s*!important/);
assert.match(hidden[2], /opacity\s*:\s*0\s*!important\s*;/);
assert.match(hidden[2], /visibility\s*:\s*hidden\s*!important\s*;/);
assert.match(css[1], /body:not\(\.journey\) #ui:focus-within[\s\S]*?transition\s*:\s*none\s*!important/);
assert.match(hidden[2], /pointer-events\s*:\s*none\s*!important\s*;/);
assert.match(css[1], /body\.cosmic\s+#cosmoHud\s*\{\s*display\s*:\s*block\s*\}/);
assert.match(template, /\bid=["']cosmoHud["']/);
console.log('PASS source rule hides cosmic HUD during journey and retains normal cosmic display declaration');
console.log('Limit: CSS source assertions only; no browser computed style, accessibility, interaction or visual check.');
