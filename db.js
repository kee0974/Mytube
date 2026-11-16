let db;
export function storageError(value,fallback='保存処理に失敗しました。空き容量と元ファイルの状態を確認してください。'){
 if(value instanceof Error)return value;
 const e=new Error(typeof value==='string'?value:value?.message||fallback);e.name=value?.name||'StorageError';return e;
}
function abortError(){return new DOMException('取り込みを中止しました。','AbortError');}
function readPart(part,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(abortError());return;}
  const stop=()=>finish(reject,abortError());
  const timer=setTimeout(()=>finish(reject,new DOMException('元ファイルの読み込みが45秒以上進んでいません。「ファイル」アプリで端末へのダウンロード完了を確認してから再試行してください。','NotReadableError')),45000);
  function finish(fn,value){clearTimeout(timer);signal?.removeEventListener('abort',stop);fn(value);}
  signal?.addEventListener('abort',stop,{once:true});
  Promise.resolve().then(()=>part.arrayBuffer()).then(b=>finish(resolve,b),e=>finish(reject,storageError(e,'元ファイルを読み込めませんでした。')));
 });
}

export const CHUNK_SIZE = 8 * 1024 * 1024;
export async function openDB() {
  if (db) db.close();
  db = await new Promise((resolve,reject) => { const req = indexedDB.open('mytube-library',2); req.onupgradeneeded = () => { const d=req.result; if(!d.objectStoreNames.contains('items'))d.createObjectStore('items',{keyPath:'id'});if(!d.objectStoreNames.contains('media'))d.createObjectStore('media');if(!d.objectStoreNames.contains('chunks')){const c=d.createObjectStore('chunks',{keyPath:['id','index']});c.createIndex('file','id');} };req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(storageError(req.error));req.onblocked=()=>reject(new Error('別のMyTube画面を閉じて再度開いてください。')); });
  db.onversionchange=()=>db.close();
  const items = await all();
  await mutate(['items'], tx => { for (const [id,name] of [['video','ビデオ'],['audio','音声']]) if (!items.some(x=>x.id===id)) tx.objectStore('items').put({id,name,type:'folder',parent:null,root:id,created:0}); });
}
export function mutate(stores, action) { return new Promise((resolve,reject)=>{
 let tx,lastError;try{tx=db.transaction(stores,'readwrite');}catch(e){reject(storageError(e));return;}
 tx.oncomplete=()=>resolve();
 // Safari can report a request error before tx.error has been populated.
 // Wait for abort so cleanup cannot race an unfinished write transaction.
 tx.onerror=event=>{lastError=event.target?.error||tx.error||lastError;};
 tx.onabort=()=>reject(storageError(lastError||tx.error,'保存が中断されました。容量不足、元ファイルの読み込み失敗、またはブラウザの保存エラーです。'));
 try{action(tx);}catch(e){lastError=storageError(e);try{tx.abort();}catch{reject(lastError);}}
 });}
function read(store,key,all=false) {return new Promise((resolve,reject)=>{const req=all?db.transaction(store).objectStore(store).getAll():db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(storageError(req.error));});}
export const all=()=>read('items',null,true);
// Compatibility/export helper. Playback uses the Service Worker's range endpoint.
export async function blob(id){const item=await read('items',id);if(!item||item.pending)return undefined;if(item.storage!=='chunks')return read('media',id);const parts=[];for(let i=0;i<Math.ceil(item.size/item.chunkSize);i++){const row=await read('chunks',[id,i]);if(!row)throw new Error('保存データの一部がありません');parts.push(row.data);}return new Blob(parts,{type:item.mime});}
export const put=item=>mutate(['items'],tx=>tx.objectStore('items').put(item));
export async function add(item,file,onProgress=()=>{},options={}){
 const saved={...item,size:file.size,mime:item.mime||file.type,storage:'chunks',chunkSize:CHUNK_SIZE,pending:true};
 await mutate(['items'],tx=>tx.objectStore('items').add(saved));
 let committed=0;
 try{
  for(let offset=0,index=0;offset<file.size;){
   const batch=[];
   // Each batch contains at most 32 MiB; no whole-file ArrayBuffer.
   while(batch.length<4&&offset<file.size){
    if(options.signal?.aborted)throw abortError();
    const end=Math.min(offset+CHUNK_SIZE,file.size);
    options.onRead?.(offset,file.size,committed);
    const buffer=await readPart(file.slice(offset,end),options.signal);
    if(buffer.byteLength!==end-offset)throw new DOMException('元ファイルの一部を読み込めませんでした。','NotReadableError');
    batch.push({id:item.id,index,data:new Blob([buffer],{type:saved.mime}),end});
    offset=end;index++;
   }
   if(options.signal?.aborted)throw abortError();
   await mutate(['chunks'],tx=>{for(const {id,index,data} of batch)tx.objectStore('chunks').add({id,index,data});});
   for(const row of batch){committed=row.end;onProgress(committed,file.size);}
  }
  if(options.signal?.aborted)throw abortError();
  saved.pending=false;await put(saved);return saved;
 }catch(e){try{await remove([item.id]);}catch{}throw storageError(e);}
}
export const remove=ids=>mutate(['items','media','chunks'],tx=>{for(const id of ids){tx.objectStore('items').delete(id);tx.objectStore('media').delete(id);const req=tx.objectStore('chunks').index('file').openCursor(IDBKeyRange.only(id));req.onsuccess=()=>{const cursor=req.result;if(cursor){cursor.delete();cursor.continue();}};}});
