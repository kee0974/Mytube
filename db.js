let db;
export const CHUNK_SIZE = 8 * 1024 * 1024;
export async function openDB() {
  if (db) db.close();
  db = await new Promise((resolve,reject) => { const req = indexedDB.open('mytube-library',2); req.onupgradeneeded = () => { const d=req.result; if(!d.objectStoreNames.contains('items'))d.createObjectStore('items',{keyPath:'id'});if(!d.objectStoreNames.contains('media'))d.createObjectStore('media');if(!d.objectStoreNames.contains('chunks')){const c=d.createObjectStore('chunks',{keyPath:['id','index']});c.createIndex('file','id');} };req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('別のMyTube画面を閉じて再度開いてください。')); });
  db.onversionchange=()=>db.close();
  const items = await all();
  await mutate(['items'], tx => { for (const [id,name] of [['video','ビデオ'],['audio','音声']]) if (!items.some(x=>x.id===id)) tx.objectStore('items').put({id,name,type:'folder',parent:null,root:id,created:0}); });
}
export function mutate(stores, action) { return new Promise((resolve,reject)=>{ const tx=db.transaction(stores,'readwrite'); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('保存を中止しました')); try { action(tx); } catch(e) { tx.abort(); reject(e); } }); }
function read(store,key,all=false) {return new Promise((resolve,reject)=>{const req=all?db.transaction(store).objectStore(store).getAll():db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export const all=()=>read('items',null,true);
// Compatibility/export helper. Playback uses the Service Worker's range endpoint.
export async function blob(id){const item=await read('items',id);if(!item||item.pending)return undefined;if(item.storage!=='chunks')return read('media',id);const parts=[];for(let i=0;i<Math.ceil(item.size/item.chunkSize);i++){const row=await read('chunks',[id,i]);if(!row)throw new Error('保存データの一部がありません');parts.push(row.data);}return new Blob(parts,{type:item.mime});}
export const put=item=>mutate(['items'],tx=>tx.objectStore('items').put(item));
export async function add(item,file,onProgress=()=>{}){
  const saved={...item,size:file.size,mime:item.mime||file.type,storage:'chunks',chunkSize:CHUNK_SIZE,pending:true};
  // Reserve the ID first; a collision must never overwrite or remove an existing file.
  await mutate(['items'],tx=>tx.objectStore('items').add(saved));
  try{for(let offset=0,index=0;offset<file.size;offset+=CHUNK_SIZE,index++){
    const data=file.slice(offset,Math.min(offset+CHUNK_SIZE,file.size));
    await mutate(['chunks'],tx=>tx.objectStore('chunks').add({id:item.id,index,data}));
    onProgress(Math.min(offset+CHUNK_SIZE,file.size),file.size);
  }saved.pending=false;await put(saved);return saved;
  }catch(e){try{await remove([item.id]);}catch{}throw e;}
}
export const remove=ids=>mutate(['items','media','chunks'],tx=>{for(const id of ids){tx.objectStore('items').delete(id);tx.objectStore('media').delete(id);const req=tx.objectStore('chunks').index('file').openCursor(IDBKeyRange.only(id));req.onsuccess=()=>{const cursor=req.result;if(cursor){cursor.delete();cursor.continue();}};}});
