function classifyPage(url, title) {
 const fallback=title||'제목 없는 페이지';
 try {
  const u=new URL(url),host=u.hostname.toLowerCase().replace(/^www\./,''),parts=u.pathname.split('/').filter(Boolean);
  const decode=x=>{try{return decodeURIComponent(x)}catch{return x}};
  if(host==='chatgpt.com') {
   const index=parts.indexOf('c');
   if(index>=0&&parts[index+1])return {category:'ChatGPT 대화',title:title&&title!=='ChatGPT'?title:'이름 없는 대화',detail:`대화 ID ${decode(parts[index+1])}`};
   if(parts.length===0)return {category:'ChatGPT',title:'ChatGPT 홈',detail:null};
   return {category:'ChatGPT',title:fallback,detail:u.pathname};
  }
  if(host==='instagram.com') {
   if(!parts.length)return {category:'Instagram',title:'Instagram 홈',detail:null};
   if(['p','reel','reels','tv'].includes(parts[0])&&parts[1])return {category:'Instagram 게시물',title:`${parts[0]==='reel'||parts[0]==='reels'?'릴스':'게시물'} · ${decode(parts[1])}`,detail:null};
   if(parts[0]==='stories'&&parts[1])return {category:'Instagram 스토리',title:`@${decode(parts[1])}`,detail:parts[2]?`스토리 ${decode(parts[2])}`:null};
   if(['explore','reels','direct','accounts','settings','developer','about','challenge'].includes(parts[0]))return {category:'Instagram',title:fallback,detail:u.pathname};
   return {category:'Instagram 프로필',title:`@${decode(parts[0])}`,detail:parts.length>1?u.pathname:null};
  }
  return {category:'페이지 방문',title:fallback,detail:null};
 } catch {return {category:'페이지 방문',title:fallback,detail:null}}
}

export function describePage(url, title) {
 const page=classifyPage(url,title);
 try {const u=new URL(url);return {...page,address:u.host+u.pathname+u.search,site:u.hostname.replace(/^www\./,'')};}
 catch {return {...page,address:'주소 정보 없음',site:'사이트 정보 없음'};}
}
