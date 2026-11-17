export async function runImportBatch(files,{signal,process,onResult=()=>{}}){
 const results=[];
 for(let i=0;i<files.length;i++){
  if(signal?.aborted){for(let j=i;j<files.length;j++){const r={file:files[j],status:'cancelled',index:j};results.push(r);onResult(r);}break;}
  let result;try{const value=await process(files[i],i);result={file:files[i],index:i,status:'saved',value};}catch(error){result={file:files[i],index:i,status:signal?.aborted?'cancelled':'failed',error};}
  results.push(result);onResult(result);
 }
 return results;
}
