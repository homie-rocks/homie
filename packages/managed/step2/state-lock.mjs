import {existsSync,openSync,closeSync,readFileSync,writeFileSync,unlinkSync,renameSync} from 'node:fs';
export function acquireStateLock(directory){
 const path=directory+'operator.lock';
 if(existsSync(path)){
  const pid=Number(readFileSync(path,'utf8'));
  if(!Number.isInteger(pid)||pid<1)throw new Error('Invalid state lock; inspect before recovery');
  try{process.kill(pid,0);throw new Error('Another step 2 operator command is active');}
  catch(error){if(error.code!=='ESRCH')throw error;unlinkSync(path);}
 }
 const fd=openSync(path,'wx');writeFileSync(fd,String(process.pid));let held=true;
 return ()=>{if(held){held=false;closeSync(fd);unlinkSync(path);}};
}
export function atomicState(path,value){const pending=path+'.pending';writeFileSync(pending,JSON.stringify(value,null,2)+'\n');renameSync(pending,path);}
