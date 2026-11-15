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
