import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../orbit-server/src/main/resources/db/data.sql');
export function parseCatalog(sql) {
  const seen = new Set();
  const num = x => x === 'NULL' || x === '' ? null : Number(x);
  return sql.split(/\r?\n/).filter(l => /^\('/.test(l)).map((line, i) => {
    const row = line.trim().replace(/^\(/, '').replace(/\)[,;]?\s*$/, '');
    const f=[]; let cur='', quoted=false;
    for(let j=0;j<row.length;j++) {
      const c=row[j];
      if(quoted) { if(c==="'") { if(row[j+1]==="'"){cur+="'";j++;} else quoted=false; } else cur+=c; }
      else if(c==="'") quoted=true;
      else if(c===','){f.push(cur);cur='';} else cur+=c;
    }
    f.push(cur);
    if(quoted || f.length!==16 || !f[0] || !f[1] || !f[4] || seen.has(f[0])) throw new Error('Invalid catalog row '+(i+1));
    seen.add(f[0]);
    for(const k of [5,6,7,8,9,15]) if(num(f[k])!==null && !Number.isFinite(num(f[k]))) throw new Error('Invalid catalog number');
    return {id:i+1,code:f[0],name:f[1],nameEn:f[2],alias:f[3],type:f[4],ra:num(f[5]),decl:num(f[6]),distanceLy:num(f[7]),diameterLy:num(f[8]),magnitude:num(f[9]),photoKey:f[10]||'',description:f[11]||'',sort:num(f[15])||0};
  });
}
export async function loadCatalog() {
  const rows=parseCatalog(await fs.readFile(SQL,'utf8'));
  if(!rows.length) throw new Error('Empty catalog');
  return rows;
}
