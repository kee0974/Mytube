import {planMoves} from './model.js?v=3.6.0';
let db;
export function storageError(value,fallback='保存処理に失敗しました。空き容量と元ファイルの状態を確認してください。'){
 if(value instanceof Error)return value;
 const e=new Error(typeof value==='string'?value:value?.message||fallback);e.name=value?.name||'StorageError';return e;
}
function abortError(){return new DOMException('取り込みを中止しました。','AbortError');}
export async function retryStorage(operation,{signal,stage='保存',onRetry=()=>{},delay=250}={}){
 for(let attempt=0;;attempt++){
  if(signal?.aborted)throw abortError();
  try{return await operation();}catch(value){
   if(signal?.aborted)throw abortError();
   const e=storageError(value);
   if(attempt>=2||!['AbortError','UnknownError','NotReadableError'].includes(e.name)){
    const wrapped=new Error(stage+'中に失敗しました。'+e.message);wrapped.name=e.name;wrapped.stage=stage;throw wrapped;
   }
   onRetry(attempt+1,stage);
   await new Promise(resolve=>setTimeout(resolve,delay*(attempt+1)));
  }
 }
}
export function readPart(part,signal,timeoutMs=45000){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(abortError());return;}
  let settled=false,reader;
  const stop=()=>finish(reject,abortError());
  const timer=setTimeout(()=>finish(reject,new DOMException('元ファイルの読み込みが進みません。「ファイル」アプリで端末へのダウンロード完了を確認してください。','NotReadableError')),timeoutMs);
  function finish(fn,value){
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);
   if(reader){reader.onload=reader.onerror=reader.onabort=null;if(reader.readyState===1)reader.abort();}
   fn(value);
  }
  signal?.addEventListener('abort',stop,{once:true});
  // FileReader can actually cancel a pending Safari read before retrying it.
  // Blob.arrayBuffer() cannot be cancelled and could leave overlapping reads.
  if(typeof FileReader!=='undefined'){
   reader=new FileReader();reader.onload=()=>finish(resolve,reader.result);
   reader.onerror=()=>finish(reject,storageError(reader.error));reader.onabort=()=>finish(reject,abortError());
   try{reader.readAsArrayBuffer(part);}catch(e){finish(reject,storageError(e));}
  }else{Promise.resolve().then(()=>part.arrayBuffer()).then(b=>finish(resolve,b),e=>finish(reject,storageError(e)));}
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
 const saved={...item,size:file.size,mime:item.mime||file.type,storage:'chunks',chunkEncoding:'arraybuffer',chunkSize:CHUNK_SIZE,pending:true};
 await retryStorage(()=>mutate(['items'],tx=>tx.objectStore('items').add(saved)),{...options,stage:'保存の準備'});
 let committed=0;
 try{
  for(let offset=0,index=0;offset<file.size;){
   const batch=[];
   // One 8 MiB chunk per transaction limits transient memory on iPad.
   while(batch.length<1&&offset<file.size){
    if(options.signal?.aborted)throw abortError();
    const end=Math.min(offset+CHUNK_SIZE,file.size);
    options.onRead?.(offset,file.size,committed);
    const buffer=await retryStorage(()=>readPart(file.slice(offset,end),options.signal),{...options,stage:"元ファイルの読み込み"});
    if(buffer.byteLength!==end-offset)throw new DOMException('元ファイルの一部を読み込めませんでした。','NotReadableError');
    batch.push({id:item.id,index,data:buffer,end});
    offset=end;index++;
   }
   if(options.signal?.aborted)throw abortError();
   await retryStorage(()=>mutate(['chunks'],tx=>{for(const {id,index,data} of batch)tx.objectStore('chunks').put({id,index,data});}),{...options,stage:'端末への保存'});
   for(const row of batch){committed=row.end;onProgress(committed,file.size);}await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(options.signal?.aborted)throw abortError();
  saved.pending=false;await retryStorage(()=>put(saved),{...options,stage:'保存の確定'});return saved;
 }catch(e){try{await remove([item.id]);}catch{}throw storageError(e);}
}
export const remove=ids=>mutate(['items','media','chunks'],tx=>{for(const id of ids){tx.objectStore('items').delete(id);tx.objectStore('media').delete(id);const req=tx.objectStore('chunks').index('file').openCursor(IDBKeyRange.only(id));req.onsuccess=()=>{const cursor=req.result;if(cursor){cursor.delete();cursor.continue();}};}});
export function setThumbnail(id,thumb,source='auto',replace=false){return mutate(['items'],tx=>{const store=tx.objectStore('items'),r=store.get(id);r.onsuccess=()=>{const entry=r.result;if(!entry||(source==='auto'&&entry.thumbSource==='custom'&&!replace))return;store.put({...entry,thumb,thumbSource:source});};});}

export function remainingRecords(ids){return new Promise((resolve,reject)=>{
 const tx=db.transaction(['items','media','chunks']);let count=0;
 tx.oncomplete=()=>resolve(count);tx.onabort=()=>reject(storageError(tx.error));
 for(const id of ids){for(const name of ['items','media']){const r=tx.objectStore(name).count(IDBKeyRange.only(id));r.onsuccess=()=>{count+=r.result;};}const r=tx.objectStore('chunks').index('file').count(IDBKeyRange.only(id));r.onsuccess=()=>{count+=r.result;};}
});}

export async function moveMany(ids,target){let validationError,changed=0;
 try{await mutate(['items'],tx=>{const store=tx.objectStore('items'),r=store.getAll();r.onsuccess=()=>{try{const moves=planMoves(r.result,ids,target);changed=moves.length;for(const entry of moves)store.put(entry);}catch(e){validationError=e;tx.abort();}};});}catch(e){throw validationError||e;}
 return changed;
}
