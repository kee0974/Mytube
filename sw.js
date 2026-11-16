const CACHE='mytube-shell-v3.2.0';
const ASSETS=['./','./index.html','./ui-v3.css?v=3.2.0','./ui-v3.js?v=3.2.0','./db.js','./model.js','./subtitles.js','./library-drag.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('mytube-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
let databasePromise;
function database(){if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{const r=indexedDB.open('mytube-library',2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('items'))d.createObjectStore('items',{keyPath:'id'});if(!d.objectStoreNames.contains('media'))d.createObjectStore('media');if(!d.objectStoreNames.contains('chunks')){const c=d.createObjectStore('chunks',{keyPath:['id','index']});c.createIndex('file','id');}};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();databasePromise=null;};resolve(r.result);};r.onerror=()=>{databasePromise=null;reject(r.error);};r.onblocked=()=>{databasePromise=null;reject(new Error('database blocked'));};});return databasePromise;}
async function read(store,key){const d=await database();return new Promise((resolve,reject)=>{const req=d.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function parseRange(value,size){if(!value)return {start:0,end:size-1,partial:false};const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||(!m[1]&&!m[2]))return null;let start,end;if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix);end=size-1;}else{start=Number(m[1]);end=m[2]?Number(m[2]):size-1;}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;return {start,end:Math.min(end,size-1),partial:true};}
async function serveMedia(request,id){
 const item=await read('items',id);if(!item||item.pending||!item.size)return new Response('Media not available',{status:404});
 const range=parseRange(request.headers.get('range'),item.size);
 if(!range)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${item.size}`,'Accept-Ranges':'bytes'}});
 const headers={'Content-Type':item.mime||(item.type==='audio'?'audio/mpeg':'video/mp4'),'Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1),'Cache-Control':'no-store'};
 if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${item.size}`;
 if(new URL(request.url).searchParams.has('download'))headers['Content-Disposition']=`attachment; filename="media.${item.type==='audio'?'mp3':'mp4'}"; filename*=UTF-8''${encodeURIComponent(item.name).replace(/'/g,'%27')}`;
 if(request.method==='HEAD')return new Response(null,{status:range.partial?206:200,headers});
 let legacy;if(item.storage!=='chunks'){legacy=await read('media',id);if(!legacy||legacy.size!==item.size)return new Response('Stored media is incomplete',{status:404});}
 let position=range.start,cancelled=false;
 const body=new ReadableStream({async pull(controller){try{if(position>range.end){controller.close();return;}const chunkSize=item.chunkSize||8*1024*1024;const index=Math.floor(position/chunkSize),offset=position%chunkSize;const source=legacy?legacy.slice(index*chunkSize,Math.min((index+1)*chunkSize,item.size)):(await read('chunks',[id,index]))?.data;if(cancelled)return;if(!source)throw new Error('Missing media chunk');const length=Math.min(source.size-offset,range.end-position+1);if(length<=0)throw new Error('Truncated media chunk');const bytes=new Uint8Array(await source.slice(offset,offset+length).arrayBuffer());if(cancelled)return;controller.enqueue(bytes);position+=length;if(position>range.end)controller.close();}catch(e){if(!cancelled)controller.error(e);}},cancel(){cancelled=true;}});
 return new Response(body,{status:range.partial?206:200,headers});
}
self.addEventListener('fetch',event=>{const url=new URL(event.request.url),scope=new URL(self.registration.scope);if(!['GET','HEAD'].includes(event.request.method)||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 const relative=url.pathname.slice(scope.pathname.length);
 if(relative==='__media_version__'){event.respondWith(Promise.resolve(new Response(null,{status:204,headers:{'X-MyTube-Media':'2','Cache-Control':'no-store'}})));return;}
 if(relative.startsWith('__media__/')){event.respondWith(serveMedia(event.request,decodeURIComponent(relative.slice(10))).catch(()=>new Response('Cannot read local media',{status:503})));return;}
 if(event.request.method!=='GET')return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);if(event.request.mode==='navigate'){try{return await fetch(event.request);}catch{return await cache.match('./index.html');}}return await cache.match(event.request)||fetch(event.request);})());});
