export const ROOTS = ['video', 'audio'];
export function ancestors(items, id) {
  const result = [], seen = new Set();
  while (id && !seen.has(id)) { seen.add(id); const item = items.find(x => x.id === id); if (!item) break; result.unshift(item); id = item.parent; }
  return result;
}
export function descendants(items, id) {
  const result = new Set([id]); const children = new Map();
  for (const item of items) { if (!children.has(item.parent)) children.set(item.parent, []); children.get(item.parent).push(item.id); }
  const queue = [id]; for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) || []) if (!result.has(child)) { result.add(child); queue.push(child); }
  return result;
}
export function canMove(items, item, target) {
  const folder = items.find(x => x.id === target);
  return !ROOTS.includes(item.id) && folder?.type === 'folder' && folder.root === item.root && !descendants(items,item.id).has(target) && item.parent !== target;
}
export function validName(value) { const name = value.trim(); if (!name || name.length > 240 || /[\x00-\x1f/\\]/.test(name) || name === '.' || name === '..') throw new Error('名前は1〜240文字で入力してください。「/」「\\」は使えません。'); return name; }

export function planMoves(items,ids,target){
 const wanted=new Set(ids),selected=items.filter(x=>wanted.has(x.id));
 if(!wanted.size||selected.length!==wanted.size)throw Error('選択した項目が見つかりません。');
 if(selected.some(x=>ROOTS.includes(x.id)))throw Error('最初のフォルダは移動できません。');
 const roots=selected.filter(x=>!ancestors(items,x.parent).some(p=>wanted.has(p.id)));
 const folder=items.find(x=>x.id===target);
 if(!folder||folder.type!=='folder')throw Error('移動先のフォルダを選んでください。');
 const names=new Set();
 for(const x of roots){
  if(x.root!==folder.root||descendants(items,x.id).has(target))throw Error('このフォルダには移動できません。');
  if(names.has(x.name)||items.some(y=>y.parent===target&&y.name===x.name&&y.id!==x.id))throw Error('移動先で名前が重複します。名前を変更してください。何も移動していません。');
  names.add(x.name);
 }
 return roots.filter(x=>x.parent!==target).map(x=>({...x,parent:target}));
}
