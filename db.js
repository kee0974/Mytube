let db;
export async function openDB() {
  if (db) db.close();
  db = await new Promise((resolve,reject) => { const req = indexedDB.open('mytube-library',1); req.onupgradeneeded = () => { const d=req.result; d.createObjectStore('items',{keyPath:'id'}); d.createObjectStore('media'); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); req.onblocked=()=>reject(new Error('別のMyTube画面を閉じて再度開いてください。')); });
  db.onversionchange=()=>db.close();
  const items = await all();
  await mutate(['items'], tx => { for (const [id,name] of [['video','ビデオ'],['audio','音声']]) if (!items.some(x=>x.id===id)) tx.objectStore('items').put({id,name,type:'folder',parent:null,root:id,created:0}); });
}
export function mutate(stores, action) { return new Promise((resolve,reject)=>{ const tx=db.transaction(stores,'readwrite'); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('保存を中止しました')); try { action(tx); } catch(e) { tx.abort(); reject(e); } }); }
function read(store,key,all=false) {return new Promise((resolve,reject)=>{const req=all?db.transaction(store).objectStore(store).getAll():db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export const all=()=>read('items',null,true);
export const blob=id=>read('media',id);
export const put=item=>mutate(['items'],tx=>tx.objectStore('items').put(item));
export const add=(item,file)=>mutate(['items','media'],tx=>{tx.objectStore('items').add(item);tx.objectStore('media').add(file,item.id);});
export const remove=ids=>mutate(['items','media'],tx=>{for(const id of ids){tx.objectStore('items').delete(id);tx.objectStore('media').delete(id);}});
