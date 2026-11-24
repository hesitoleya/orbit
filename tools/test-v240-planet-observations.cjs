'use strict';
/* v240 的行星表现契约已被 v241 取代（见 tools/test-v241-planet-globes.cjs）：
   v240 把任务观测图正交贴到前半球，观感是「弯起来的纸 + 背面空洞」，用户明确否掉。
   这里保留的是仍然有效的那部分：图鉴的任务观测照片与来源记录不能因为改渲染而丢失。 */
const fs = require('node:fs'), assert = require('node:assert/strict');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/data/atlas-photos/manifest.json', 'utf8'));

for (const key of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun', 'earth']) {
  assert(manifest.records[key], `atlas observation ${key} still recorded`);
  assert(fs.existsSync('public/data/atlas-photos/' + manifest.records[key].file), `${key} observation file exists`);
}
assert(app.includes('atlasPhotos') && app.includes("'atlas-photos/'"), 'atlas still serves the mission photographs');
assert(!app.includes('makeObservedPhotoLayer'), 'front-hemisphere 2D close-up layer retired by v241');
assert(!app.includes('PHOTO_DRAG'), 'drag hijack retired by v241');
assert(fs.existsSync('tools/test-v241-planet-globes.cjs'), 'successor contract test present');
assert(app.includes('lroc_color_4k') || app.includes('moonLroc'), 'Moon map chain unchanged');
console.log('PASS v240 successor: mission observation photographs and their provenance remain in the atlas, while the front-hemisphere orthographic close-up layer and its drag hijack are retired in favour of v241 planet globes.');
