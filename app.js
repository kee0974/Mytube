import * as db from './db.js';
import {ROOTS,ancestors,descendants,canMove,validName} from './model.js';
const $=id=>document.getElementById(id);
let items=[], current='home', busy=false, mediaURL=null, toastTimer;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const size=n=> n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';
const duration=n=>Number.isFinite(n)?`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`:'';
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function error(e){console.error(e);toast(e.name==='QuotaExceededError'?'保存容量が足りません。不要なファイルを削除してください。':e.message||'操作に失敗しました。');}
function action(label, fn, cls=''){const b=el('button',cls,label);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(error);return b;}
function modal(title){$('modal-title').textContent=title;$('modal-body').replaceChildren();$('modal-actions').replaceChildren();$('modal-form').onsubmit=e=>e.preventDefault();if(!$('modal').open)$('modal').showModal();}
function closeModal(){$('modal').close();}
async function refresh(){items=await db.all();render();await storage();}
function navigate(id){if(busy)return toast('取り込みが終わるまでお待ちください。');$('search').value='';location.hash=id==='home'?'':encodeURIComponent(id);current=id;render();}
function render(){
  const folder=items.find(x=>x.id===current);if(current!=='home'&&!folder)current='home';
  const query=$('search').value.trim().toLocaleLowerCase();
  document.querySelectorAll('[data-go]').forEach(b=>b.classList.toggle('active',b.dataset.go===(current==='home'?'home':folder?.root)));
  $('title').textContent=query?'検索結果':folder?.name||'ライブラリ';
  $('subtitle').textContent=query?`「${$('search').value.trim()}」をライブラリ全体から検索`:current==='home'?'お気に入りの瞬間も、いつもの音楽も。ここに。':'このフォルダに、あなたのお気に入りを。';
  $('new-folder').disabled=busy||current==='home'||!!query;$('import').disabled=busy||!!query;
  $('crumbs').replaceChildren(action('ホーム',()=>navigate('home')));
  for(const p of ancestors(items,current)){$('crumbs').append(el('span','','›'),action(p.name,()=>navigate(p.id)));}
  let visible=items.filter(x=>query?x.name.toLocaleLowerCase().includes(query):x.parent===(current==='home'?null:current));
  visible.sort((a,b)=>(current==='home'&&!query?ROOTS.indexOf(a.id)-ROOTS.indexOf(b.id):0)||(a.type==='folder'?0:1)-(b.type==='folder'?0:1)||($('sort').value==='date'?b.created-a.created:a.name.localeCompare(b.name,'ja',{numeric:true})));
  $('section-title').textContent=current==='home'&&!query?'フォルダ':`${visible.length} 件の項目`;$('grid').replaceChildren();$('empty').hidden=visible.length>0;
  if(query&&!visible.length){$('empty').querySelector('h2').textContent='見つかりませんでした';$('empty').querySelector('p').textContent='別の名前で検索してください。';}else{$('empty').querySelector('h2').textContent='ここから、コレクションを。';$('empty').querySelector('p').textContent='「ファイルを追加」からMP4・MP3を取り込めます。フォルダを作って整理しましょう。';}
  for(const item of visible){
    const card=el('article','card '+item.type), main=el('button','card-main'),art=el('div','art');main.type='button';
    if(item.type==='folder')art.append(el('span','folder-icon'));
    else if(item.thumb){const img=el('img');img.src=item.thumb;img.alt='';img.loading='lazy';art.append(img);}else art.textContent=item.type==='audio'?'♫':'▶';
    if(item.duration)art.append(el('span','duration',duration(item.duration)));
    const info=el('div','card-info');info.append(el('span','card-title',item.name));
    let sub=item.type==='folder'?`${items.filter(x=>x.parent===item.id).length} 項目`:size(item.size);
    if(query&&item.parent)sub+=' · '+ancestors(items,item.parent).map(x=>x.name).join(' / ');
    info.append(el('span','card-sub',sub));main.append(art,info);let held=false,timer,start;
    main.onclick=()=>{if(held){held=false;return;}if(busy)return;item.type==='folder'?navigate(item.id):play(item).catch(error);};
    if(!ROOTS.includes(item.id)){
      const menu=action('⋯',()=>menuFor(item),'more');menu.setAttribute('aria-label',`${item.name}の操作`);card.append(menu);
      main.oncontextmenu=e=>{e.preventDefault();if(!busy)menuFor(item);};
      main.onpointerdown=e=>{held=false;start=[e.clientX,e.clientY];timer=setTimeout(()=>{held=true;if(!busy)menuFor(item);},600);};
      main.onpointermove=e=>{if(start&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>10)clearTimeout(timer);};
      for(const evt of ['pointerup','pointercancel','pointerleave'])main.addEventListener(evt,()=>clearTimeout(timer));
    }card.prepend(main);$('grid').append(card);
  }
}
function nameDialog(item){
 modal(item?'名前を変更':'新しいフォルダ');const input=el('input');input.value=item?.name||'';input.maxLength=240;input.required=true;input.setAttribute('aria-label','名前');$('modal-body').append(input);
 const save=async()=>{const name=validName(input.value),parent=item?item.parent:current;if(items.some(x=>x.parent===parent&&x.name===name&&x.id!==item?.id))throw new Error('同じ名前の項目があります。');await db.put(item?{...item,name}:{id:crypto.randomUUID(),name,parent,root:items.find(x=>x.id===parent).root,type:'folder',created:Date.now()});closeModal();await refresh();};
 $('modal-actions').append(action('保存',save,'primary'));$('modal-form').onsubmit=e=>{e.preventDefault();save().catch(error);};input.focus();input.select();
}
function menuFor(item){if(busy)return;modal(item.name);$('modal-body').textContent=item.type==='folder'?'フォルダの操作':'ファイルの操作';$('modal-actions').append(action('名前を変更',()=>nameDialog(item)),action('別のフォルダへ移動',()=>moveDialog(item)));
 if(item.type!=='folder')$('modal-actions').append(action('ファイルに書き出す',()=>exportFile(item)));
 $('modal-actions').append(action('削除',()=>{const ids=descendants(items,item.id);modal('削除しますか？');$('modal-body').textContent=`「${item.name}」${item.type==='folder'?`と中の${ids.size-1}項目`:''}を削除します。この操作は取り消せません。`;$('modal-actions').append(action('削除する',async()=>{await db.remove(ids);closeModal();await refresh();toast('削除しました');},'danger'),action('キャンセル',closeModal));},'danger'));
}
function moveDialog(item){let target=item.root;const excluded=descendants(items,item.id);modal('移動先のフォルダ');const body=$('modal-body');
 const show=()=>{body.replaceChildren();body.append(el('p','',ancestors(items,target).map(x=>x.name).join(' / ')));const node=items.find(x=>x.id===target);if(node.parent)body.append(action('‹ 上のフォルダ',()=>{target=node.parent;show();},'destination'));
 for(const f of items.filter(x=>x.type==='folder'&&x.parent===target&&!excluded.has(x.id)).sort((a,b)=>a.name.localeCompare(b.name,'ja')))body.append(action('📁 '+f.name+' ›',()=>{target=f.id;show();},'destination'));
 $('modal-actions').replaceChildren();const move=action('このフォルダへ移動',async()=>{if(!canMove(items,item,target))throw new Error('この場所には移動できません。');if(items.some(x=>x.parent===target&&x.name===item.name&&x.id!==item.id))throw new Error('移動先に同じ名前の項目があります。');await db.put({...item,parent:target});closeModal();await refresh();toast('移動しました');},'primary');move.disabled=!canMove(items,item,target);$('modal-actions').append(move);};show();
}
function metadata(file,type){return new Promise(resolve=>{const media=document.createElement(type==='video'?'video':'audio'),url=URL.createObjectURL(file);let finished=false,seconds;media.preload='metadata';media.muted=true;media.playsInline=true;
 const finish=(thumb)=>{if(finished)return;finished=true;clearTimeout(timeout);media.removeAttribute('src');media.load();URL.revokeObjectURL(url);resolve({duration:seconds,thumb});};
 const timeout=setTimeout(()=>finish(),5000);media.onerror=()=>finish();media.onloadedmetadata=()=>{seconds=Number.isFinite(media.duration)?media.duration:undefined;if(type==='audio')finish();else {media.currentTime=Math.min(1,(seconds||1)/2);}};
 media.onseeked=()=>{try{const c=document.createElement('canvas');c.width=480;c.height=Math.max(1,Math.round(480*media.videoHeight/media.videoWidth));c.getContext('2d').drawImage(media,0,0,c.width,c.height);finish(c.toDataURL('image/jpeg',.65));}catch{finish();}};media.src=url;});}
async function importFiles(files){if(busy||!files.length)return;busy=true;render();$('import-status').hidden=false;let success=0;const failures=[];const parent=current;
 try{for(let i=0;i<files.length;i++){const file=files[i];$('import-status').textContent=`取り込み中 ${i+1} / ${files.length} — ${file.name}（完了するまで画面を開いてください）`;
 try{const ext=file.name.split('.').pop().toLowerCase();if(!['mp4','mp3'].includes(ext))throw new Error('MP4・MP3のみ対応');if(!file.size)throw new Error('空のファイル');const type=ext==='mp4'?'video':'audio',dest=parent==='home'?type:parent;if(parent!=='home'&&items.find(x=>x.id===parent).root!==type)throw new Error(type==='video'?'ビデオ内へ追加してください':'音声内へ追加してください');
 const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&estimate.quota-estimate.usage<file.size*1.05)throw new Error('空き容量が足りません');
 let name=file.name,index=2;while(items.some(x=>x.parent===dest&&x.name===name)){name=file.name.replace(/\.(mp4|mp3)$/i,` (${index++}).$1`);}const meta=await metadata(file,type);const item={id:crypto.randomUUID(),name,parent:dest,root:type,type,size:file.size,mime:type==='video'?'video/mp4':'audio/mpeg',created:Date.now(),...meta};await db.add(item,file.slice(0,file.size,item.mime));items.push(item);success++;}catch(e){failures.push(`${file.name}: ${e.name==='QuotaExceededError'?'保存容量が足りません':e.message}`);}}
 }finally{busy=false;$('file-input').value='';$('import-status').textContent=`${success} 件を保存しました。`+(failures.length?` ${failures.length} 件は保存できませんでした。`:'');await refresh();}
 if(failures.length){modal('取り込み結果');$('modal-body').append(el('p','',`${success} 件を保存しました。`));for(const msg of failures)$('modal-body').append(el('p','',msg));$('modal-actions').append(action('閉じる',closeModal));}
}
async function play(item){const data=await db.blob(item.id);if(!data)throw new Error('ファイルが見つかりません。再度取り込んでください。');stop();mediaURL=URL.createObjectURL(data);$('player-title').textContent=item.name;const media=el(item.type==='video'?'video':'audio');media.controls=true;media.playsInline=true;media.preload='metadata';media.src=mediaURL;
 if(item.type==='audio')$('media-host').append(el('div','audio-stage','♫'));$('media-host').append(media);$('player-message').textContent='再生バーでシークできます。';media.onerror=()=>{$('player-message').textContent='このメディアを再生できません。MP4の映像・音声コーデックがSafariに対応しているか確認してください。';};
 if(item.type==='video'){$('media-host').append(action('⛶ 全画面',()=>{if(media.webkitEnterFullscreen)media.webkitEnterFullscreen();else if(media.requestFullscreen)return media.requestFullscreen();else toast('プレーヤーの全画面ボタンをご利用ください。');}));}
 $('player').showModal();try{await media.play();}catch{$('player-message').textContent='再生ボタンをタップしてください。';}}
function stop(){const media=$('media-host').querySelector('video,audio');if(media){media.pause();media.removeAttribute('src');media.load();}$('media-host').replaceChildren();if(mediaURL)URL.revokeObjectURL(mediaURL);mediaURL=null;}
async function exportFile(item){const data=await db.blob(item.id);if(!data)throw new Error('ファイルがありません');const url=URL.createObjectURL(data),a=el('a');a.href=url;a.download=item.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('ダウンロードしたファイルを保存してください');}
async function storage(){try{const usage=await navigator.storage?.estimate?.();$('usage').textContent=usage?.quota?`${size(usage.usage)} 使用 / 上限の目安 ${size(usage.quota)}`:`メディア ${size(items.reduce((sum,x)=>sum+(x.size||0),0))}`;}catch{$('usage').textContent='容量情報を取得できません';}}
function help(){modal('MyTubeの使い方');const paragraphs=['「ビデオ」「音声」を開き、フォルダを自由に作成できます。「ファイルを追加」でAppleの「ファイル」からMP4・MP3を選択してください。ホームから追加すると種類別に振り分けます。','項目の「⋯」または長押しで名前の変更・移動・削除。移動は同じ種類のライブラリ内で行えます。ファイルは書き出して保管できます。','Safariの共有メニュー →「ホーム画面に追加」でアプリとして利用できます。初回はオンラインで開き、「オフライン準備完了」を確認してください。保存済みメディアは通信なしで再生できます。','動画・音声・フォルダはこのブラウザ内のIndexedDBに保存され、外部へアップロードされません。他の端末・ブラウザへ自動同期はしません。','端末の容量不足、長期間の未使用、サイトデータ削除などによりデータが消える場合があります。永続保存は保証されません。元ファイルは必ず別途保管してください。プライベートブラウズは使わないでください。','MP4でも内部のコーデックによっては再生できません。大容量ファイルは1件ずつ取り込み、完了までアプリを開いてください。'];for(const p of paragraphs)$('modal-body').append(el('p','',p));$('modal-actions').append(action('閉じる',closeModal));}
$('modal-close').onclick=closeModal;$('player-close').onclick=()=>$('player').close();$('player').addEventListener('close',stop);$('help').onclick=help;$('search').oninput=render;$('sort').onchange=render;$('new-folder').onclick=()=>nameDialog();$('import').onclick=()=>{const root=items.find(x=>x.id===current)?.root;$('file-input').accept=root==='video'?'.mp4,video/mp4':root==='audio'?'.mp3,audio/mpeg':'.mp4,.mp3,video/mp4,audio/mpeg';$('file-input').click();};$('file-input').onchange=()=>importFiles(Array.from($('file-input').files)).catch(error);
$('persist').onclick=async()=>{try{const granted=await navigator.storage?.persist?.();toast(granted?'永続保存が許可されました。元ファイルの保管も続けてください。':'このブラウザでは保存保護が許可されませんでした。元ファイルを保管してください。');}catch(e){error(e);}};
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));window.addEventListener('hashchange',()=>{if(busy)return;try{current=decodeURIComponent(location.hash.slice(1))||'home';}catch{current='home';}$('search').value='';render();});window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
let offlineReady=false;function connection(){$('connection').textContent=!navigator.onLine?'● オフライン':offlineReady?'● オフライン準備完了':'オンライン';}window.addEventListener('online',connection);window.addEventListener('offline',connection);
try{await db.openDB();try{current=decodeURIComponent(location.hash.slice(1))||'home';}catch{}await refresh();connection();if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;connection();}).catch(()=>{$('connection').textContent='オフライン準備に失敗・再読込してください';});}}catch(e){$('import').disabled=true;$('new-folder').disabled=true;modal('保存機能を開始できません');$('modal-body').textContent='Safariの通常モードで開き直してください。'+e.message;}
