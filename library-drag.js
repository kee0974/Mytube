import {ROOTS,descendants} from './model.js';
export function canEnter(items,source,target){
 const folder=items.find(x=>x.id===target);
 return !!folder&&folder.type==='folder'&&folder.root===source.root&&!descendants(items,source.id).has(target);
}
export function validateDrop(items,sourceId,target){
 const source=items.find(x=>x.id===sourceId);
 if(!source||ROOTS.includes(sourceId))throw Error('この項目は移動できません。');
 if(!canEnter(items,source,target))throw Error('この場所には移動できません。同じ種類のフォルダを選んでください。');
 if(source.parent===target)return null;
 if(items.some(x=>x.id!==sourceId&&x.parent===target&&x.name===source.name))throw Error('移動先に同じ名前の項目があります。上書きはしていません。');
 return {...source,parent:target};
}
export function enableLibraryDrag(api){
 let pending=null,drag=null,hoverTimer=null,hoverKey='',scrollFrame=0;
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const status=document.createElement('div');status.className='drag-status';status.setAttribute('role','status');status.hidden=true;document.body.append(status);
 function clearPending(){if(pending)clearTimeout(pending.timer);pending=null;}
 function clearHover(){clearTimeout(hoverTimer);hoverKey='';document.querySelectorAll('.drop-hover').forEach(x=>x.classList.remove('drop-hover'));}
 function sourceCard(id){return [...document.querySelectorAll('[data-item-id]')].find(x=>x.dataset.itemId===id);}
 function position(){if(!drag)return;drag.ghost.style.left=(drag.x-drag.width/2)+'px';drag.ghost.style.top=(drag.y-70)+'px';}
 function hit(){
  if(!drag)return null;
  const element=document.elementFromPoint(drag.x,drag.y);if(!element)return null;
  const page=api.page(),source=api.items().find(x=>x.id===drag.id);if(!source)return null;
  const back=element.closest('#back');
  if(back&&!back.hidden){const target=api.items().find(x=>x.id===page)?.parent||'home';return {kind:'back',target,element:back};}
  const crumb=element.closest('[data-folder-id]');if(crumb){const target=crumb.dataset.folderId;if(target==='home'||canEnter(api.items(),source,target))return {kind:'folder',target,element:crumb};return {kind:'invalid',element:crumb};}
  const card=element.closest('[data-item-id]');
  if(card){const target=api.items().find(x=>x.id===card.dataset.itemId);if(target?.id===source.id)return {kind:'same',target:source.parent,element:card};if(target?.type==='folder'&&canEnter(api.items(),source,target.id))return {kind:'folder',target:target.id,element:card};return {kind:'invalid',element:card};}
  if(element.closest('#library,#main'))return {kind:'space',target:page,element:null};
  return {kind:'invalid',element:null};
 }
 function hover(){
  if(!drag||drag.transition||drag.finishing)return;
  const target=hit(),key=target?target.kind+':'+target.target:'';
  if(key===hoverKey)return;clearHover();hoverKey=key;
  if(!target||!['folder','back'].includes(target.kind))return;
  if(target.target===api.page())return;
  target.element?.classList.add('drop-hover');
  hoverTimer=setTimeout(()=>{
   if(!drag||drag.finishing)return;const current=drag;clearHover();
   current.transition=Promise.resolve(api.navigate(target.target,target.kind==='back')).catch(api.error).finally(()=>{if(drag===current){current.transition=null;sourceCard(current.id)?.classList.add('drag-source');hover();}});
  },800);
 }
 function autoscroll(){
  if(!drag||drag.finishing)return;
  if(!drag.transition){const threshold=60;const amount=drag.y>innerHeight-threshold?Math.min(12,(drag.y-(innerHeight-threshold))/4):drag.y<95?-Math.min(10,(95-drag.y)/5):0;if(amount){window.scrollBy(0,amount);hover();}}
  scrollFrame=requestAnimationFrame(autoscroll);
 }
 function begin(p){
  if(pending!==p||api.blocked())return;clearPending();api.prepare();
  const source=api.items().find(x=>x.id===p.id);if(!source||ROOTS.includes(source.id))return;
  const rect=p.card.getBoundingClientRect(),ghost=p.card.cloneNode(true);ghost.classList.add('drag-ghost');ghost.removeAttribute('data-item-id');ghost.querySelectorAll('[id]').forEach(x=>x.removeAttribute('id'));ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.style.width=Math.min(rect.width,190)+'px';
  drag={id:p.id,pointer:p.pointer,x:p.x,y:p.y,startX:p.x,startY:p.y,moved:false,ghost,width:Math.min(rect.width,190),transition:null,finishing:false};
  document.body.append(ghost);document.body.classList.add('library-dragging');p.card.classList.add('drag-source');document.body.setPointerCapture(p.pointer);position();
  if(!reduced())ghost.animate([{transform:'scale(.95)',opacity:.7},{transform:'scale(1.06)',opacity:1}],{duration:180,easing:'ease-out'});
  status.hidden=false;status.textContent='移動先へドラッグ · フォルダや戻るボタンに重ねると開きます';api.suppress();autoscroll();
 }
 document.addEventListener('pointerdown',e=>{
  if(drag||api.blocked()||!e.isPrimary||e.button!==0)return;
  const card=e.target.closest('[data-item-id]');if(!card||e.target.closest('.item-menu'))return;
  const source=api.items().find(x=>x.id===card.dataset.itemId);if(!source||ROOTS.includes(source.id)||source.pending)return;
  clearPending();const p={id:source.id,card,pointer:e.pointerId,x:e.clientX,y:e.clientY};pending=p;p.timer=setTimeout(()=>begin(p),350);
 },true);
 document.addEventListener('pointermove',e=>{
  if(pending&&pending.pointer===e.pointerId&&Math.hypot(e.clientX-pending.x,e.clientY-pending.y)>10)clearPending();
  if(!drag||drag.pointer!==e.pointerId||drag.finishing)return;
  if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();drag.x=e.clientX;drag.y=e.clientY;drag.moved ||= Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>12;position();hover();
 },{capture:true,passive:false});
 async function finish(e,cancel){
  if(pending?.pointer===e.pointerId)clearPending();
  if(!drag||drag.pointer!==e.pointerId||drag.finishing)return;
  if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();const d=drag;d.finishing=true;clearHover();cancelAnimationFrame(scrollFrame);api.suppress();
  if(Number.isFinite(e.clientX)){d.x=e.clientX;d.y=e.clientY;}
  let landing=null;
  try{
   if(d.transition)await d.transition;
   if(!cancel&&d.moved){
    const target=hit();if(!target||!['folder','back','space','same'].includes(target.kind)||target.target==='home')throw Error('フォルダの中か、移動先のフォルダ上で指を離してください。');
    landing=target.element?.getBoundingClientRect();await api.drop(d.id,target.target);
   }
   const destination=sourceCard(d.id)||document.querySelector('.drop-hover');
   const rect=destination?.getBoundingClientRect()||landing;
   if(!reduced()){const from=d.ghost.getBoundingClientRect(),dx=rect?rect.left+rect.width/2-(from.left+from.width/2):0,dy=rect?rect.top-from.top:0;await d.ghost.animate([{transform:'scale(1.06)',opacity:1},{transform:`translate(${dx}px,${dy}px) scale(.75)`,opacity:0}],{duration:200,easing:'ease-in',fill:'forwards'}).finished.catch(()=>{});}
  }catch(err){api.error(err);if(!reduced())await d.ghost.animate([{transform:'translateX(-7px)'},{transform:'translateX(7px)'},{transform:'translateX(0)'}],{duration:180}).finished.catch(()=>{});}
  finally{
   drag=null;d.ghost.remove();document.body.classList.remove('library-dragging');document.querySelectorAll('.drag-source').forEach(x=>x.classList.remove('drag-source'));status.hidden=true;if(document.body.hasPointerCapture(d.pointer))document.body.releasePointerCapture(d.pointer);api.suppress();
  }
 }
 document.addEventListener('pointerup',e=>finish(e,false),true);
 document.addEventListener('pointercancel',e=>finish(e,true),true);
 document.body.addEventListener('lostpointercapture',e=>{if(e.target===document.body&&drag?.pointer===e.pointerId&&!drag.finishing)finish(e,true);});
 document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-item-id]')||drag){e.preventDefault();}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag)finish({pointerId:drag.pointer,stopImmediatePropagation(){},cancelable:false},true);});
 return {active:()=>!!drag};
}
