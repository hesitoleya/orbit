'use strict';
// Deliberately separate from production server and build. Whitelisted files only.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),report=path.join(root,'.workbuddy/v208-roi/report.json');
const m=JSON.parse(fs.readFileSync(path.join(root,'public/data/cinematic-nebula/manifest.json'),'utf8')),p=m.profiles.find(p=>p.id==='orion');
const files={'/':path.join(__dirname,'index.html'),'/lab.js':path.join(__dirname,'lab.js'),'/kernel.js':path.join(__dirname,'kernel.js'),'/report.json':report,'/base.gz':path.join(root,'public/data/cinematic-nebula',p.medium.file),'/brick.gz':path.join(root,'.workbuddy/v208-roi/orion-roi-256.rgba8.bin.gz')};
const port=Number(process.env.ROI_PORT||8174);
http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);return res.end();}const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(u.pathname==='/profile.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(p));}
 const f=Object.hasOwn(files,u.pathname)?files[u.pathname]:null;if(!f){res.writeHead(404);return res.end('Not found');}
 fs.stat(f,(e,s)=>{if(e){res.writeHead(404);return res.end('Missing lab artifact');}res.setHeader('Content-Type',f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.json')?'application/json':'application/octet-stream');res.setHeader('Content-Length',s.size);const stream=fs.createReadStream(f);stream.on('error',()=>{if(res.headersSent)res.destroy();else{res.removeHeader('Content-Length');res.writeHead(500);res.end('Read failed');}});stream.pipe(res);});
}).listen(port,'127.0.0.1',()=>console.log('Isolated ROI laboratory: http://127.0.0.1:'+port+' / production entry unchanged'));
