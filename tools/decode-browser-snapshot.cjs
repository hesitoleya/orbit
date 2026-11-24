'use strict';
// Decode an already captured BrowserSkill data URL from its retained JSON reply.
const fs=require('node:fs');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('input JSON reply and new output PNG required');
const data=JSON.parse(fs.readFileSync(input,'utf8'));
const url=data.value?.png;
if(typeof url!=='string'||!url.startsWith('data:image/png;base64,'))throw Error('Missing PNG data URL');
fs.writeFileSync(output,Buffer.from(url.split(',')[1],'base64'),{flag:'wx'});
console.log(output);
