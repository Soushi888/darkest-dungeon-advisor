// U31 (Soushi, 06:42: "Comment On..., because it is a popup is often dismissed while I'm writing because of a page reload"):
// a rebuild never reloads the page under his hands. While the comment popup is open, or a field he types in has focus or
// unsent text, the reload waits until it closes or sends (a field that only has focus holds it 15 s at most, C94: a note field left focused kept
// the Hamlet page up after the coach had left); and the two drafts the board does not keep by itself (the popup's
// comment, the road message) are kept across any reload anyway, and put back where they were.
export const keepDrafts = `const DK='ddDrafts';const pop=()=>document.getElementById('pinpop'),road=()=>document.getElementById('roadText');
window.ddWriting=(waited=0)=>{const p=pop(),a=document.activeElement,r=road();if(p&&p.classList.contains('on'))return true;if(r&&r.value.trim())return true;return waited<15000&&!!(a&&(a.tagName==='TEXTAREA'||a.tagName==='INPUT'&&a.type==='text'||a.isContentEditable))};
const keep=()=>{try{const p=pop(),r=road(),d={pin:p&&p.classList.contains('on')?p.querySelector('textarea').value:'',road:r?r.value:''};if(d.pin||d.road)sessionStorage.setItem(DK,JSON.stringify(d));else sessionStorage.removeItem(DK)}catch{}};
addEventListener('beforeunload',keep);addEventListener('input',keep,true);
const back=()=>{let d;try{d=JSON.parse(sessionStorage.getItem(DK)||'null')}catch{}if(!d)return;const r=road();if(d.road&&r&&!r.value){r.value=d.road;d.road=''}
if(d.pin){const p=pop();if(p){const fill=()=>{const t=p.querySelector('textarea');if(p.classList.contains('on')&&t&&!t.value){t.value=d.pin;d.pin='';try{sessionStorage.setItem(DK,JSON.stringify(d))}catch{}o.disconnect()}};const o=new MutationObserver(fill);o.observe(p,{attributes:true,attributeFilter:['class']})}}
try{sessionStorage.setItem(DK,JSON.stringify(d))}catch{}};
if(document.readyState==='loading')addEventListener('DOMContentLoaded',()=>setTimeout(back,0));else setTimeout(back,0);setTimeout(back,1500);`
