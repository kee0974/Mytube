export function parseSubtitles(text){
 const cues=[];
 for(const block of text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split(/\n[ \t]*\n/)){
  if(/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(block.trim()))continue;
  const lines=block.split('\n'),index=lines.findIndex(x=>x.includes('-->'));if(index<0)continue;
  const match=lines[index].match(/^\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s.*)?$/);if(!match)continue;
  const time=s=>{const p=s.replace(',','.').split(':').map(Number);if(p.at(-1)>=60||p.at(-2)>=60)return NaN;return p.reduce((n,x)=>n*60+x,0);};
  const start=time(match[1]),end=time(match[2]);let value=lines.slice(index+1).join('\n').replace(/<[^>]*>/g,'').trim();value=value.replace(/&(amp|lt|gt|nbsp|quot);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',nbsp:' ',quot:'"'})[e]);
  if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&value)cues.push({start,end,text:value});
 }
 if(!cues.length)throw Error('時間と文章のあるSRT／VTT字幕を選択してください。');return cues.sort((a,b)=>a.start-b.start);
}
