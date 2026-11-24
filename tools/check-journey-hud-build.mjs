// Compare in-memory builds with the existing artifacts plus the explicitly expected HUD/focus edits.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let source = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8').replace(/\r\n/g, '\n');
function replaceOnce(text, before, after) {
  const parts = text.split(before);
  assert.equal(parts.length, 2, 'missing or ambiguous replacement boundary');
  return parts[0] + after + parts[1];
}
source = replaceOnce(source, "const ROOT = path.dirname(fileURLToPath(import.meta.url));", `const ROOT = ${JSON.stringify(root)};`);
source = replaceOnce(source, `for (const name of ['space.html', 'index.html']) {
  fs.writeFileSync(path.join(ROOT, name), htmlOffline);
}
fs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`, `
for (const [name, content] of [['space.html', htmlOffline], ['index.html', htmlOffline], ['space-http.html', htmlHttp]]) globalThis.__hudBuildCompare(name, content);
`);
globalThis.__hudBuildCompare = (name, content) => {
  const existing = fs.readFileSync(path.join(root, name), 'utf8');
  let patched = replaceOnce(existing,
    '    body.journey #hud, body.journey #hint { opacity: 0 !important; pointer-events: none !important; }\n    #ui, #labels, #cosmoLabels, #crumbs { transition: opacity .45s ease; }',
    '    body.journey #hud, body.journey #cosmoHud, body.journey #hint, body.journey #atlasBtn { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }\n    body.journey #atlasBtn { transition: none !important; }\n    body:not(.journey) #atlasBtn { transition: background .16s, border-color .16s, color .16s; }\n    #ui, #labels, #cosmoLabels, #crumbs { transition: opacity .45s ease; }\n    body:not(.journey) #ui:focus-within, body:not(.journey) #labels:focus-within,\n    body:not(.journey) #cosmoLabels:focus-within, body:not(.journey) #crumbs:focus-within,\n    body:not(.journey) #hud:focus-within, body:not(.journey) #cosmoHud:focus-within,\n    body:not(.journey) #hint:focus-within, body:not(.journey) #atlasBtn:focus-within { transition: none !important; }');
  // The embedded app uses CRLF even though the surrounding HTML template uses LF.
  // Preserve both line-ending styles; normalizing here would hide unrelated differences.
  patched = replaceOnce(patched,
    "function journeyStart(i) {\r\n  _terrainRecoveryPending = false;\r\n  pendingEarthStart = false;\r\n  JOURNEY.on = true;\r\n  JOURNEY.i = -1;\r\n  JOURNEY.busy = false;\r\n  document.body.classList.add('journey');\r\n  JOURNEY_HIDE = true;",
    "function journeyStart(i) {\r\n  _terrainRecoveryPending = false;\r\n  pendingEarthStart = false;\r\n  JOURNEY.on = true;\r\n  JOURNEY.i = -1;\r\n  JOURNEY.busy = false;\r\n  const focused = document.activeElement;\r\n  if (focused && focused.closest('#ui,#labels,#cosmoLabels,#crumbs,#hud,#cosmoHud,#hint,#atlasBtn')) focused.blur();\r\n  document.body.classList.add('journey');\r\n  JOURNEY_HIDE = true;");
  assert.ok(Buffer.from(patched).equals(Buffer.from(content)), `${name}: rebuild has differences beyond expected HUD/focus edits`);
  console.log(`PASS ${name}: complete in-memory rebuild differs only by expected HUD/focus edits`);
};
try { await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')); }
finally { delete globalThis.__hudBuildCompare; }
console.log('No artifacts written; browser rendering and style behavior remain untested.');
