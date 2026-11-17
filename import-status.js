export function formatImportError(e){
 if(e?.name==='QuotaExceededError')return '保存容量が足りません。元ファイルは削除しないでください。';
 if(e?.name==='AbortError')return (e.stage?e.stage+'が中断されました。':'ブラウザが処理を中断しました。')+'保存済みのファイルは残っています。未保存分を再試行してください。元ファイルがクラウド上の場合は「ファイル」アプリで端末へのダウンロード完了を確認してください。';
 if(e?.name==='NotReadableError')return e.message||'元ファイルを読み込めません。「ファイル」アプリで端末へのダウンロード完了を確認してください。';
 if(typeof e==='string'&&e)return e;
 return e?.message||'保存処理が失敗しましたが、ブラウザから原因が返されませんでした。空き容量と元ファイルの状態を確認してください。';
}
export function importProgress(done,total,seconds,phase){
 const mb=n=>(n/1048576).toFixed(1)+' MB';
 const rate=seconds>0?done/seconds:0;
 return (phase==='thumbnail'?'保存済み・サムネイル準備中':phase==='read'?'元ファイル読み込み・端末内へ保存中':'端末内へ保存中')+' '+Math.floor(done/total*100)+'% / '+mb(done)+' / '+mb(total)+' · '+(rate?mb(rate)+'/秒':'速度計測中')+' · '+Math.floor(seconds)+'秒経過'+(seconds>15&&!done?'（クラウド上のファイルは取得に時間がかかる場合があります）':'');
}
