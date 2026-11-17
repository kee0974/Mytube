import {imageThumbnail,videoThumbnail} from './thumbnails.js';
import {runImportBatch} from './import-batch.js';
import {enableLibraryDrag,validateDrop} from './library-drag.js';
import {formatImportError,importProgress} from './import-status.js';
import {parseSubtitles} from './subtitles.js';
import * as db from './db.js?v=3.3.0';
import {ROOTS,ancestors,descendants,canMove,validName} from './model.js';
const $=id=>document.getElementById(id),audio=$('audio'),video=$('video'),ctx=$('canvas').getContext('2d');
const icons={volume:'<path d="M11 5 6 9H3v6h3l5 4Z M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',mark:'<path d="M6 21V4m0 0c4-3 8 3 13 0v10c-5 3-9-3-13 0"/>',cc:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 10a3 3 0 1 0 0 4M18 10a3 3 0 1 0 0 4"/>',play:'<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',full:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',exit:'<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>'};
const icon=(id,n)=>$(id).innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[n]+'</svg>';
icon('volbtn','volume');icon('mark','mark');icon('cc','cc');icon('play','play');icon('full','full');$('cc').classList.add('on');
let page='home',stack=[],item=null,media=audio,ac,analyser,data,bins,raf=0,cc=true,dragging=false,gesture=null,lastTap=null,feedbackTimer;
let items=[],busy=false,offlineReady=false,libraryDrag=null,importController=null;
const heights=new Float32Array(9);
const fmt=t=>{t=Math.max(0,Math.floor(t||0));return(t>=3600?Math.floor(t/3600)+':':'')+String(Math.floor(t/60)%60).padStart(t>=3600?2:1,'0')+':'+String(t%60).padStart(2,'0');};
const notice=s=>$('notice').textContent=s;
let navigating=false,suppressClickUntil=0;
const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
async function animatePage(direction,change){
 if(navigating)return;navigating=true;
 const main=$('main'),width=main.getBoundingClientRect().width;
 const start=main.style.transform||'translateX(0px)';
 try{
  if(!reducedMotion()&&main.animate){
   const out=main.animate([{transform:start,opacity:1},{transform:`translateX(${direction==='back'?width:-45}px)`,opacity:direction==='back'?1:0}],{duration:direction==='back'?210:120,easing:'cubic-bezier(.2,.7,.25,1)',fill:'forwards'});
   await out.finished.catch(()=>{});change();main.style.transform='';out.cancel();
   const incoming=main.animate([{transform:`translateX(${direction==='back'?-35:55}px)`,opacity:.35},{transform:'translateX(0px)',opacity:1}],{duration:210,easing:'cubic-bezier(.2,.7,.25,1)'});
   await incoming.finished.catch(()=>{});
  }else{main.style.transform='';change();}
 }finally{main.style.transform='';navigating=false;}
}
function go(p){if(busy||libraryDrag?.active())return;return animatePage('forward',()=>{stack.push(page);page=p;render();});}
async function back(){if(!stack.length||navigating||busy)return;if(document.fullscreenElement)try{await document.exitFullscreen();}catch{}$('screen').classList.remove('expanded');document.body.style.overflow='';return animatePage('back',()=>{page=stack.pop();render();});}
function render(){
 clearTimeout(tapTimer);
 if(gesture){clearTimeout(gesture.timer);gesture=null;}media.pause();cancelAnimationFrame(raf);lastTap=null;$('feedback').hidden=true;
 const playing=typeof page==='object';$('player').hidden=!playing;$('library').hidden=playing;
 const folder=items.find(x=>x.id===page);if(!playing&&page!=='home'&&!folder)page='home';
 $('back').hidden=page==='home';const previous=stack.at(-1);$('back').textContent='‹ '+(items.find(x=>x.id===previous)?.name||'ブラウズ');
 $('add').hidden=playing;$('add').disabled=busy;$('new-folder').hidden=playing||page==='home';$('new-folder').disabled=busy;
 $('crumbs').replaceChildren();const chain=ancestors(items,playing?page.parent:page==='home'?null:page);
 for(const node of [{id:'home',name:'ブラウズ'},...chain]){const b=document.createElement('button');b.textContent=node.name;b.dataset.folderId=node.id;b.disabled=busy;b.onclick=()=>go(node.id);$('crumbs').append(b);}
 if(playing){openPlayer(page);return;}item=null;$('library').replaceChildren();$('title').textContent=folder?.name||'ブラウズ';
 const grid=document.createElement('div');grid.className='grid';
 const list=items.filter(x=>x.parent===(page==='home'?null:page)).sort((a,b)=>(a.type==='folder'?0:1)-(b.type==='folder'?0:1)||a.name.localeCompare(b.name,'ja'));
 for(const x of list){
  const card=document.createElement('div');card.className='file-card';card.dataset.itemId=x.id;
  const b=document.createElement('button');b.className='tile';b.disabled=busy;b.setAttribute('aria-label',x.name+'を開く');
  const a=document.createElement('span');a.className=x.type==='folder'?'folder':'thumb '+(x.type==='audio'?'music':'');
  if(x.type!=='folder'){if(x.thumb){const img=document.createElement('img');img.src=x.thumb;img.alt='';a.append(img);}else a.textContent=x.type==='audio'?'♫':'▶';}
  b.append(a);b.onclick=()=>{if(x.pending){menu(x);return;}go(x.type==='folder'?x.id:x);};
  const n=document.createElement('button');n.className='name';n.textContent=x.name;n.disabled=busy;n.setAttribute('aria-label',ROOTS.includes(x.id)?x.name+'を開く':x.name+'の名前を変更');
  n.onclick=e=>{e.stopPropagation();if(ROOTS.includes(x.id))go(x.id);else rename(x);};
  const small=document.createElement('span');small.className='muted';small.textContent=x.type==='folder'?items.filter(y=>y.parent===x.id).length+'項目':x.pending?'取り込み中断':x.duration?fmt(x.duration):size(x.size);
  card.append(b,n,small);
  if(!ROOTS.includes(x.id)){const more=document.createElement('button');more.className='item-menu';more.textContent='⋯';more.setAttribute('aria-label',x.name+'の操作');more.onclick=e=>{e.stopPropagation();menu(x);};card.append(more);}
  grid.append(card);
 }
 $('library').append(grid);$('count').textContent=list.length+'項目';setTimeout(scheduleThumbs,0);
}
function graph(){if(ac)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ac=new AC();analyser=ac.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.55;ac.createMediaElementSource(audio).connect(analyser);analyser.connect(ac.destination);data=new Float32Array(analyser.fftSize);bins=new Uint8Array(analyser.frequencyBinCount);}
function getMarks(){return item?.marks||[];}
let markQueue=Promise.resolve();
function save(list){
 if(!item)return;const target=item;target.marks=list;drawMarks();
 markQueue=markQueue.then(async()=>{const latest=(await db.all()).find(x=>x.id===target.id);if(!latest)return;await db.put({...latest,marks:list});items=await db.all();}).catch(()=>notice('マークを保存できませんでした。空き容量を確認してください。'));
}
function seek(t){if(Number.isFinite(media.duration)){media.currentTime=Math.max(0,Math.min(media.duration,t));sync();}}
function drawMarks(){$('marks').replaceChildren();$('ticks').replaceChildren();for(const m of [...getMarks()].sort((a,b)=>a.t-b.t)){const b=document.createElement('button');b.textContent=fmt(m.t);b.setAttribute('aria-label',fmt(m.t)+'へ移動');b.title='タップで移動・長押しで削除';let hold,held=false;const remove=()=>{held=true;if(confirm(fmt(m.t)+'のマークを削除しますか？'))save(getMarks().filter(x=>x.id!==m.id));};b.onclick=()=>{if(!held)seek(m.t);held=false;};b.onpointerdown=()=>{held=false;hold=setTimeout(remove,650);};for(const e of ['pointerup','pointerleave','pointercancel'])b.addEventListener(e,()=>clearTimeout(hold));b.oncontextmenu=e=>{e.preventDefault();clearTimeout(hold);if(!held)remove();};$('marks').append(b);if(Number.isFinite(media.duration)&&media.duration>0){const tick=document.createElement('span');tick.className='tick';tick.style.left=Math.min(100,m.t/media.duration*100)+'%';$('ticks').append(tick);}}}
function playState(){icon('play',media.paused?'play':'pause');$('play').setAttribute('aria-label',media.paused?'再生':'一時停止');}
function sync(){const t=media.currentTime||0,d=media.duration;if(!dragging)$('seek').value=t;$('seek').max=Number.isFinite(d)?d:60;$('elapsed').textContent=fmt(t);$('duration').textContent=Number.isFinite(d)?fmt(d):'--:--';let caption='';caption=(item?.subtitles||[]).filter(c=>t>=c.start&&t<c.end).map(c=>c.text).join('\n');$('caption').hidden=!cc||!caption||!!gesture?.active;$('caption').firstElementChild.textContent=caption;}
function openPlayer(x){item=x;notice('');$('title').textContent=x.name;$('count').textContent=x.type==='audio'?'音声':'ビデオ';media=x.type==='video'?video:audio;video.hidden=media!==video;$('visual').hidden=media===video;$('volbox').hidden=true;$('volbtn').setAttribute('aria-expanded','false');media.src=localMediaURL(x);media.volume=Number($('volume').value);media.load();heights.fill(0);dragging=false;$('seek').value=0;drawMarks();playState();fullState();draw();}
function draw(){if(!item)return;if(media===audio){ctx.clearRect(0,0,450,192);let rms=0;const bands=new Float32Array(9);if(analyser&&!media.paused){analyser.getFloatTimeDomainData(data);analyser.getByteFrequencyData(bins);for(const v of data)rms+=v*v;rms=Math.min(1,Math.sqrt(rms/data.length)*12);const step=ac.sampleRate/analyser.fftSize;for(let i=0;i<9;i++){const low=Math.max(1,Math.floor(100*Math.pow(1.55,i)/step)),high=Math.min(bins.length-1,Math.ceil(100*Math.pow(1.55,i+1)/step));for(let j=low;j<=high;j++)bands[i]=Math.max(bands[i],bins[j]/255);}}ctx.fillStyle='#fff';for(let i=0;i<9;i++){const target=rms*(.2+.8*bands[i]);heights[i]+=(target-heights[i])*.3;const h=24+heights[i]*145;ctx.beginPath();ctx.roundRect(22+i*47,(192-h)/2,30,h,15);ctx.fill();}}sync();raf=requestAnimationFrame(draw);}
for(const m of [audio,video]){m.addEventListener('loadedmetadata',()=>{if(m===media){drawMarks();sync();}});for(const e of ['play','pause','ended'])m.addEventListener(e,()=>{if(m===media)playState();});m.addEventListener('error',()=>{if(m===media)notice(navigator.serviceWorker?.controller?'保存データを再生できませんでした。対応形式・保存内容を確認してください。元ファイルは削除しないでください。':'再生の準備中です。オンラインで一度再読み込みしてください。');});}
async function togglePlayback(){if(!media.paused){media.pause();return;}try{if(media===audio){graph();if(ac)await ac.resume();}await media.play();}catch{notice('再生を開始できませんでした。もう一度押してください。');}}
$('play').onclick=()=>{clearTimeout(tapTimer);lastTap=null;togglePlayback();};
$('seek').oninput=()=>{dragging=true;seek(Number($('seek').value));};$('seek').onchange=()=>dragging=false;$('seek').onpointercancel=()=>dragging=false;
$('volbtn').onclick=()=>{$('volbox').hidden=!$('volbox').hidden;$('volbtn').setAttribute('aria-expanded',String(!$('volbox').hidden));};$('volume').oninput=()=>media.volume=Number($('volume').value);
$('cc').onclick=()=>{if(!item?.subtitles?.length){subtitleMenu(item);return;}cc=!cc;$('cc').classList.toggle('on',cc);$('cc').setAttribute('aria-pressed',String(cc));$('cc').setAttribute('aria-label',cc?'字幕を非表示':'字幕を表示');if(cc&&!item?.subtitles?.length)notice('このファイルには字幕データがありません。自動文字起こしは未対応です。');};
$('mark').onclick=()=>{if(!Number.isFinite(media.duration)||getMarks().some(m=>Math.abs(m.t-media.currentTime)<.25))return;save([...getMarks(),{id:Date.now()+'-'+Math.random().toString(36).slice(2),t:media.currentTime}]);};
function fullState(){const on=!!document.fullscreenElement||$('screen').classList.contains('expanded');icon('full',on?'exit':'full');$('full').setAttribute('aria-label',on?'全画面を終了':'全画面表示');}
$('full').onclick=async()=>{const s=$('screen');try{if(document.fullscreenElement)await document.exitFullscreen();else if(s.classList.contains('expanded')){s.classList.remove('expanded');document.body.style.overflow='';}else{try{if(!s.requestFullscreen)throw Error();await s.requestFullscreen();}catch{s.classList.add('expanded');document.body.style.overflow='hidden';}}}catch{notice('全画面を切り替えられませんでした。');}fullState();};
document.addEventListener('fullscreenchange',fullState);document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('screen').classList.remove('expanded');document.body.style.overflow='';fullState();}});
function feedback(text,detail){clearTimeout(feedbackTimer);$('feedback').replaceChildren(document.createTextNode(text));if(detail){const small=document.createElement('small');small.textContent=detail;$('feedback').append(small);}$('feedback').hidden=false;}
function hideSoon(){clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>$('feedback').hidden=true,700);}
let tapTimer;
function queuePlayerTap(e){
 const rect=screen.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width,side=x<.3?'left':x>.7?'right':null,now=performance.now();
 clearTimeout(tapTimer);
 if(side&&lastTap&&lastTap.side===side&&now-lastTap.t<340){seek(media.currentTime+(side==='left'?-10:10));feedback(side==='left'?'−10秒':'＋10秒');hideSoon();lastTap=null;return;}
 lastTap={side,t:now};const target=media,selected=item;
 tapTimer=setTimeout(()=>{lastTap=null;if(media===target&&item===selected)togglePlayback();},350);
}
const screen=$('screen');screen.addEventListener('contextmenu',e=>{if(!e.target.closest('.controls'))e.preventDefault();});
screen.addEventListener('pointerdown',e=>{
 if(e.target.closest('.controls')||!e.isPrimary||e.button!==0||gesture||navigating)return;
 gesture={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now(),active:false,valid:true,media,origin:media.currentTime};
 screen.setPointerCapture(e.pointerId);
});
function updateSeekGesture(e){
 const g=gesture;if(!g||g.id!==e.pointerId||!g.valid)return;
 const dx=e.clientX-g.x,dy=e.clientY-g.y;
 if(!g.active){
  if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.4){g.valid=false;return;}
  if(Math.abs(dx)<6||Math.abs(dx)<Math.abs(dy)*1.2||!Number.isFinite(media.duration))return;
  g.active=true;g.resume=!media.paused;media.pause();clearTimeout(tapTimer);lastTap=null;
 }
 if(e.cancelable)e.preventDefault();
 const destination=Math.max(0,Math.min(media.duration,g.origin+dx*.2));seek(destination);
 const delta=destination-g.origin;feedback(fmt(destination),(delta>=0?'＋':'−')+Math.abs(delta).toFixed(1)+'秒');
}
screen.addEventListener('pointermove',updateSeekGesture);
function finish(e,cancel=false){
 const g=gesture;if(!g||g.id!==e.pointerId)return;
 if(!cancel)updateSeekGesture(e);
 gesture=null;if(screen.hasPointerCapture(e.pointerId))screen.releasePointerCapture(e.pointerId);
 if(g.active){if(cancel)seek(g.origin);if(g.resume&&media===g.media)media.play().catch(()=>notice('再生ボタンを押して再開してください。'));hideSoon();return;}
 if(cancel||!g.valid||performance.now()-g.t>400){lastTap=null;return;}
 queuePlayerTap(e);
}
screen.addEventListener('pointerup',e=>finish(e));screen.addEventListener('pointercancel',e=>finish(e,true));screen.addEventListener('lostpointercapture',e=>{if(gesture?.id===e.pointerId)finish(e,true);});
let swipe=null;
const main=$('main');
function resetSwipe(){
 const start=main.style.transform;main.style.transform='';
 if(start&&!reducedMotion()&&main.animate)main.animate([{transform:start},{transform:'translateX(0px)'}],{duration:160,easing:'ease-out'});
 swipe=null;
}
function beginBackSwipe(e){
 if(libraryDrag?.active()||busy||navigating||!stack.length||!e.isPrimary||e.button!==0||$('about').open||$('actions').open)return;
 if(e.target.closest('input,.controls,#marks,button:not(.tile)'))return;
 const inPlayer=!!e.target.closest('#screen');
 const edge=inPlayer&&e.clientX-screen.getBoundingClientRect().left<=48;
 if(inPlayer&&!edge)return;
 swipe={x:e.clientX,y:e.clientY,id:e.pointerId,active:false,t:performance.now(),edge};
 if(edge)e.stopPropagation();
}
function moveBackSwipe(e){
 if(libraryDrag?.active()||!swipe||swipe.id!==e.pointerId)return;
 const dx=e.clientX-swipe.x,dy=Math.abs(e.clientY-swipe.y);
 if(!swipe.active){
  if(dy>16&&dy>Math.abs(dx)*1.4){resetSwipe();return;}
  if(dx<8||dx<dy*1.1)return;
  swipe.active=true;main.setPointerCapture(e.pointerId);
 }
 if(e.cancelable)e.preventDefault();
 if(!reducedMotion())main.style.transform=`translateX(${Math.max(0,dx)}px)`;
}
function endBackSwipe(e,cancel=false){
 if(libraryDrag?.active()||!swipe||swipe.id!==e.pointerId)return;
 const g=swipe,dx=e.clientX-g.x,dy=Math.abs(e.clientY-g.y),elapsed=Math.max(1,performance.now()-g.t);
 swipe=null;
 if(main.hasPointerCapture(e.pointerId))main.releasePointerCapture(e.pointerId);
 if(g.active)suppressClickUntil=Date.now()+450;
 if(!cancel&&g.edge&&!g.active&&Math.abs(dx)<8&&dy<8&&elapsed<400){queuePlayerTap(e);resetSwipe();return;}
 if(!cancel&&dx>dy*1.15&&(dx>=50||(dx>=25&&dx/elapsed>.35))){suppressClickUntil=Date.now()+450;back();}else resetSwipe();
}
document.addEventListener('pointerdown',beginBackSwipe,true);
window.addEventListener('pointermove',moveBackSwipe,{passive:false});
window.addEventListener('pointerup',e=>endBackSwipe(e));
window.addEventListener('pointercancel',e=>endBackSwipe(e,true));
main.addEventListener('lostpointercapture',e=>{
 // Capture moving from a touched tile to main emits a bubbling loss on the tile.
 // Only a loss belonging to main itself can cancel the page gesture.
 if(e.target===main&&swipe?.id===e.pointerId)resetSwipe();
});
document.addEventListener('click',e=>{if(navigating||Date.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);

function metadata(file,type){return new Promise(resolve=>{const media=document.createElement(type==='video'?'video':'audio'),url=URL.createObjectURL(file);let finished=false,seconds;media.preload='metadata';media.muted=true;media.playsInline=true;
 const finish=(thumb)=>{if(finished)return;finished=true;clearTimeout(timeout);media.removeAttribute('src');media.load();URL.revokeObjectURL(url);resolve({duration:seconds,thumb});};
 const timeout=setTimeout(()=>finish(),5000);media.onerror=()=>finish();media.onloadedmetadata=()=>{seconds=Number.isFinite(media.duration)?media.duration:undefined;if(type==='audio')finish();else {media.currentTime=Math.min(1,(seconds||1)/2);}};
 media.onseeked=()=>{try{const c=document.createElement('canvas');c.width=480;c.height=Math.max(1,Math.round(480*media.videoHeight/media.videoWidth));c.getContext('2d').drawImage(media,0,0,c.width,c.height);finish(c.toDataURL('image/jpeg',.65));}catch{finish();}};media.src=url;});}

function size(n){return n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil((n||0)/1024)+' KB';}
function localMediaURL(x,download=false){const u=new URL('./__media__/'+encodeURIComponent(x.id),location.href);if(download)u.searchParams.set('download','1');return u.href;}
function error(e){alert(formatImportError(e));}
async function refresh(){items=await db.all();render();}
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=()=>Promise.resolve().then(fn).catch(error);return b;}
function actions(title){$('action-title').textContent=title;$('action-body').replaceChildren();if(!$('actions').open)$('actions').showModal();return $('action-body');}
function uniqueName(name,parent,except){if(items.some(x=>x.parent===parent&&x.name===name&&x.id!==except))throw Error('同じ名前の項目があります。');return name;}
function rename(x){const body=actions(x?'名前を変更':'新しいフォルダ'),input=document.createElement('input');input.value=x?.name||'';input.maxLength=240;input.setAttribute('aria-label','名前');body.append(input);body.append(button('保存',async()=>{const parent=x?x.parent:page,name=uniqueName(validName(input.value),parent,x?.id);const latest=x?(await db.all()).find(y=>y.id===x.id):null;if(x&&!latest)throw Error('項目が見つかりません。');await db.put(latest?{...latest,name}:{id:crypto.randomUUID(),name,parent,root:items.find(y=>y.id===page).root,type:'folder',created:Date.now()});$('actions').close();await refresh();}));input.focus();}
function menu(x){if(busy||ROOTS.includes(x.id))return;const body=actions(x.name);body.append(button('名前を変更',()=>rename(x)),button('別のフォルダへ移動',()=>move(x)));if(x.type!=='folder'&&!x.pending){body.append(button('サムネイルを変更',()=>{thumbnailTarget=x.id;$('thumbnail-file').value='';$('thumbnail-file').click();}));if(x.type==='video')body.append(button('動画からサムネイルを作り直す',()=>regenerateThumb(x)));body.append(button('字幕を設定',()=>subtitleMenu(x)));}if(x.type!=='folder'&&!x.pending)body.append(button('ファイルに書き出す',()=>{const a=document.createElement('a');a.href=localMediaURL(x,true);a.download=x.name;document.body.append(a);a.click();a.remove();}));const del=button('削除',async()=>{const ids=descendants(items,x.id);if(!confirm('「'+x.name+'」'+(ids.size>1?'と中の'+(ids.size-1)+'項目':'')+'を削除しますか？'))return;await markQueue;await db.remove([...ids]);$('actions').close();await refresh();});del.className='danger';body.append(del);}
function move(x){let target=x.root;const excluded=descendants(items,x.id);function show(){const body=actions('移動先を選択'),p=document.createElement('p');p.textContent=ancestors(items,target).map(y=>y.name).join(' / ');body.append(p);const parent=items.find(y=>y.id===target)?.parent;if(parent)body.append(button('‹ 上のフォルダ',()=>{target=parent;show();}));for(const f of items.filter(y=>y.type==='folder'&&y.parent===target&&!excluded.has(y.id)))body.append(button('📁 '+f.name,()=>{target=f.id;show();}));const save=button('このフォルダへ移動',async()=>{if(!canMove(items,x,target))throw Error('この場所には移動できません。');uniqueName(x.name,target,x.id);const latest=(await db.all()).find(y=>y.id===x.id);if(!latest)throw Error('項目が見つかりません。');await db.put({...latest,parent:target});$('actions').close();await refresh();});save.disabled=!canMove(items,x,target);body.append(save);}show();}
let retryFiles=[],retryParent='home';
async function importFiles(selection,parent=page){
 const list=Array.from(selection);if(busy||!list.length)return;
 busy=true;importController=new AbortController();retryParent=parent;retryFiles=[];render();
 $('import-status').hidden=false;$('import-cancel').hidden=false;$('import-retry').hidden=true;$('import-cancel').textContent='取り込みを中止';
 $('import-results').replaceChildren();let success=0;
 const rows=list.map(file=>{const row=document.createElement('li');row.textContent=file.name+' — 待機中';$('import-results').append(row);return row;});
 try{
  await runImportBatch(list,{signal:importController.signal,process:async(file,i)=>{
   const started=performance.now();let done=0,phase='read';
   const display=()=>{$('import-status').textContent=`${i+1}/${list.length}（保存済み ${success}件） ${file.name} — `+importProgress(done,file.size,(performance.now()-started)/1000,phase);};
   rows[i].textContent=file.name+' — 保存中';display();const ticker=setInterval(display,1000);
   try{
   const ext=file.name.split('.').pop().toLowerCase();if(!['mp4','mp3'].includes(ext))throw Error('MP4・MP3のみ対応しています。');if(!file.size)throw Error('空のファイルです。');
   const type=ext==='mp4'?'video':'audio',destination=parent==='home'?type:parent;
   if(parent!=='home'&&items.find(x=>x.id===parent)?.root!==type)throw Error('対応する「ビデオ」または「音声」のフォルダに追加してください。');
   const usage=await navigator.storage?.estimate?.();if(usage?.quota&&usage.quota-usage.usage<file.size*1.05)throw new DOMException('空き容量が足りません。','QuotaExceededError');
   let name=file.name,index=2;while(items.some(x=>x.parent===destination&&x.name===name))name=file.name.replace(/\.(mp4|mp3)$/i,` (${index++}).$1`);
   // Large files are saved first; thumbnail probing must not delay import.
   const entry={id:crypto.randomUUID(),name,parent:destination,root:type,type,size:file.size,mime:type==='video'?'video/mp4':'audio/mpeg',created:Date.now()};
   const saved=await db.add(entry,file,(bytes)=>{done=bytes;phase='write';display();},{signal:importController.signal,onRead:()=>{phase='read';display();}});
   items.push(saved);if(type==='video')thumbQueue.add(saved.id);return saved;

   }finally{clearInterval(ticker);}
  },onResult:r=>{
   if(r.status==='saved'){success++;rows[r.index].textContent=r.file.name+' — 保存済み';}
   else{retryFiles.push(r.file);rows[r.index].textContent=r.file.name+' — '+(r.status==='cancelled'?'中止・未保存':formatImportError(r.error));}
  }});
 }catch(e){error(e);}finally{
  busy=false;importController=null;$('import-cancel').hidden=true;$('import-retry').hidden=!retryFiles.length;
  $('import-status').textContent=`${list.length}件中 ${success}件を保存しました。`+(retryFiles.length?`${retryFiles.length}件は未保存です。下の一覧を確認してください。`:'');
  try{await refresh();scheduleThumbs();}catch(e){error(e);}
 }
}
async function info(){try{const u=await navigator.storage?.estimate?.(),protectedStorage=await navigator.storage?.persisted?.();$('storage-info').textContent=(u?size(u.usage)+' 使用 / 容量の目安 '+size(u.quota):'容量情報なし')+'。保存保護: '+(protectedStorage?'許可済み':'未許可');}catch{$('storage-info').textContent='容量情報を取得できません。';}$('offline-info').textContent=offlineReady?'オフライン用画面を準備済み':'オフラインの準備中、または未完了';$('about').showModal();}
$('back').onclick=back;$('info').onclick=info;$('close').onclick=()=>$('about').close();$('action-close').onclick=()=>$('actions').close();$('new-folder').onclick=()=>rename();
$('add').onclick=()=>{$('file').value='';const root=items.find(x=>x.id===page)?.root;$('file').accept=root==='video'?'.mp4,video/mp4':root==='audio'?'.mp3,audio/mpeg':'.mp4,.mp3,video/mp4,audio/mpeg';$('file').click();};
$('import-cancel').onclick=()=>{importController?.abort();$('import-cancel').textContent='中止処理中…';};
$('file').onchange=e=>{const list=Array.from(e.target.files);importFiles(list).catch(error);};
$('import-retry').onclick=()=>importFiles(retryFiles,retryParent).catch(error);
$('protect').onclick=async()=>{try{const granted=await navigator.storage?.persist?.();$('storage-info').textContent=granted?'保存保護が許可されました。Webサイトデータの手動削除は防げません。':'この環境では保存保護が許可されませんでした。元ファイルは別にも保管してください。';}catch(e){error(e);}};
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
let subtitleTarget=null;
function subtitleMenu(x){
 if(!x)return;const body=actions('字幕 — '+x.name);const p=document.createElement('p');p.textContent=x.subtitles?.length?x.subtitles.length+'件の字幕を保存済みです。':'字幕データがありません。SRT／VTTを追加するか、時刻と文章を入力してください。自動文字起こしではありません。';body.append(p);
 body.append(button('SRT／VTTファイルを選ぶ',()=>{subtitleTarget=x;$('subtitle-file').click();}),button('字幕を手入力する',()=>editSubtitle(x)));
 if(x.subtitles?.length){body.append(button('字幕を表示 / 非表示',()=>{cc=!cc;$('cc').classList.toggle('on',cc);$('cc').setAttribute('aria-pressed',String(cc));$('actions').close();}),button('字幕を削除',async()=>{if(confirm('このファイルの字幕を削除しますか？')){await saveSubtitles(x,[]);$('actions').close();}}));}
}
async function saveSubtitles(x,cues){
 await markQueue;const latest=(await db.all()).find(y=>y.id===x.id);if(!latest)throw Error('ファイルが見つかりません。');
 await db.put({...latest,subtitles:cues});x.subtitles=cues;if(item?.id===x.id)item.subtitles=cues;items=await db.all();cc=true;$('cc').classList.add('on');$('cc').setAttribute('aria-pressed','true');sync();
}
function editSubtitle(x){
 const body=actions('字幕を追加');const inputs=[];
 for(const [label,value,type] of [['開始（秒）',String(Math.floor(item?.id===x.id?media.currentTime:0)),'number'],['終了（秒）',String(Math.floor(item?.id===x.id?media.currentTime:0)+5),'number'],['字幕の文章','','text']]){const l=document.createElement('label');l.textContent=label;const input=document.createElement(type==='text'?'textarea':'input');if(type!=='text'){input.type=type;input.min='0';input.step='.1';}input.value=value;input.setAttribute('aria-label',label);l.append(input);body.append(l);inputs.push(input);}
 body.append(button('保存',async()=>{const start=Number(inputs[0].value),end=Number(inputs[1].value),text=inputs[2].value.trim();if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!text)throw Error('開始・終了時刻と字幕の文章を確認してください。');await saveSubtitles(x,[...(x.subtitles||[]),{start,end,text}].sort((a,b)=>a.start-b.start));$('actions').close();}));
}
$('subtitle-file').onchange=async e=>{const file=e.target.files[0],target=subtitleTarget;e.target.value='';if(!file||!target)return;try{if(file.size>5*1024*1024)throw Error('字幕ファイルは5MB以下で指定してください。');const cues=parseSubtitles(await file.text());await saveSubtitles(target,cues);$('actions').close();notice(cues.length+'件の字幕を保存しました。');}catch(e){error(e);}};
let thumbnailTarget=null,thumbWorker=false;
const thumbQueue=new Set(),attemptedThumbs=new Set();
function updateThumbTiles(){for(const card of document.querySelectorAll('[data-item-id]')){const entry=items.find(x=>x.id===card.dataset.itemId),art=card.querySelector('.thumb');if(!entry?.thumb||!art)continue;let img=art.querySelector('img');if(!img){img=document.createElement('img');img.alt='';art.replaceChildren(img);}if(img.getAttribute('src')!==entry.thumb)img.src=entry.thumb;}}
async function reloadThumbMetadata(){items=await db.all();if(item){const x=items.find(x=>x.id===item.id);if(x){item.thumb=x.thumb;item.thumbSource=x.thumbSource;}}updateThumbTiles();}
function scheduleThumbs(){for(const x of items)if(x.type==='video'&&!x.pending&&!x.thumb&&!attemptedThumbs.has(x.id))thumbQueue.add(x.id);runThumbQueue();}
async function runThumbQueue(){
 if(thumbWorker||!thumbQueue.size||!navigator.serviceWorker?.controller)return;thumbWorker=true;
 try{while(thumbQueue.size){
  if(busy||item||libraryDrag?.active()){setTimeout(runThumbQueue,1500);break;}
  const id=thumbQueue.values().next().value;thumbQueue.delete(id);attemptedThumbs.add(id);
  const x=(await db.all()).find(x=>x.id===id);if(!x||x.thumb||x.pending)continue;
  const image=await videoThumbnail(localMediaURL(x));if(image){await db.setThumbnail(id,image,'auto');await reloadThumbMetadata();}
 }}catch(e){console.warn('Thumbnail preparation failed',e);}finally{thumbWorker=false;}
}
async function regenerateThumb(x){const body=actions('サムネイルを作成中…');body.textContent='動画から画像を取得しています。';const image=await videoThumbnail(localMediaURL(x));if(!image)throw Error('動画から画像を取得できませんでした。「サムネイルを変更」から画像を選べます。');await db.setThumbnail(x.id,image,'auto',true);await reloadThumbMetadata();$('actions').close();}
$('thumbnail-file').onchange=async e=>{const file=e.target.files[0],id=thumbnailTarget;if(!file||!id)return;try{const image=await imageThumbnail(file);await db.setThumbnail(id,image,'custom');await reloadThumbMetadata();$('actions').close();}catch(e){error(e);}};
video.addEventListener('loadeddata',()=>{if(!item||item.type!=='video'||item.thumb)return;const id=item.id;try{const c=document.createElement('canvas');c.width=480;c.height=Math.max(1,Math.round(480*video.videoHeight/video.videoWidth));c.getContext('2d').drawImage(video,0,0,c.width,c.height);db.setThumbnail(id,c.toDataURL('image/jpeg',.8),'auto').then(reloadThumbMetadata).catch(()=>{});}catch{}});
libraryDrag=enableLibraryDrag({
 items:()=>items,page:()=>typeof page==='string'?page:page.parent,
 blocked:()=>busy||navigating||typeof page!=='string'||$('actions').open||$('about').open,
 prepare:()=>{resetSwipe();clearTimeout(tapTimer);},
 suppress:()=>{suppressClickUntil=Date.now()+650;},
 navigate:async(target,backward)=>{
  if(navigating)return;
  await animatePage(backward?'back':'forward',()=>{
   page=target;const path=target==='home'?[]:ancestors(items,target);stack=target==='home'?[]:['home',...path.slice(0,-1).map(x=>x.id)];render();
  });
 },
 drop:async(id,target)=>{
  await markQueue;const latest=await db.all(),updated=validateDrop(latest,id,target);
  if(updated)await db.put(updated);items=await db.all();render();
  if(updated){$('import-status').hidden=false;$('import-status').textContent='「'+updated.name+'」を「'+items.find(x=>x.id===target).name+'」へ移動しました。';}
 },error:e=>{$('import-status').hidden=false;$('import-status').textContent=e.message||'移動できませんでした。';}
});
try{
 await db.openDB();items=await db.all();render();
 if('serviceWorker' in navigator){navigator.serviceWorker.addEventListener('controllerchange',()=>{scheduleThumbs();if(item&&media.error){media.load();notice('再生の準備ができました。再生ボタンを押してください。');}});navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;scheduleThumbs();}).catch(()=>{$('import-status').hidden=false;$('import-status').textContent='オフラインの準備に失敗しました。オンラインで再読み込みしてください。';});}
}catch(e){$('add').disabled=true;$('new-folder').disabled=true;$('library').textContent='保存データを開けませんでした。Safariの通常モードで開いてください。'+e.message;}
