import { createAppRecords } from '@homie-rocks/studio/apps';
import { createShop } from '@homie-rocks/studio/shop';
import { appLink, qrSvg } from '@homie-rocks/studio/links';
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const params = new URLSearchParams(location.search), role=params.get('role')||'customer';
const slots=createAppRecords<any>({collection:'slots'}), bookings=createAppRecords<any>({collection:'bookings'}),shop=createShop({target:parent});
let slotRows:any[]=[],rows:any[]=[],busy=false,ticket=params.get('ticket')||'';
try{ticket ||= localStorage.getItem('coldsmoke-ticket')||'';}catch{}
const origin=new URL(document.referrer||location.href).origin;
const publicLink=(id='')=>appLink('/tune/open',id?{ticket:id}:{},origin);
document.body.className=role;
$('#customer').hidden=role!=='customer';$('#staff').hidden=role!=='staff';$('#staff-work').hidden=role!=='staff';
$('#customer').insertBefore($('#tracking'),$('#slots'));
$('#qr').innerHTML=qrSvg(publicLink(),{title:'Book a tune'});
const el=(tag:string,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
const label=(id:string)=>slotRows.find(s=>s.id===id)?.data.label||id;
function paint(){
 $('#rail').replaceChildren();
 for(const row of rows.filter(r=>r.data.state!=='released')){const gear=el('article','','gear '+row.data.state);gear.dataset.booking=row.id;gear.append(el('div','','ski'));const card=el('div','','ticket');card.append(el('strong',row.data.state==='confirmed'?'PAID / SECURED':'PENDING'),el('span',label(row.data.slot)),el('small','#'+row.id.slice(-6)+' · v'+row.version));gear.append(card);$('#rail').append(gear);}
 if(!rows.some(r=>r.data.state!=='released'))$('#rail').append(el('div','The rail is clear. Your next mountain day starts here.','empty'));
 $('#count').textContent=`${rows.filter(r=>r.data.state==='confirmed').length} paid bookings`;
 $('#slots').replaceChildren();$('#staff-slots').replaceChildren();
 for(const s of slotRows){const line=el('div','','slot'),desc=el('div',s.data.label);desc.append(el('div',s.booking?.full?'Full':s.booking?.synced?`${s.booking.available} available`:'Awaiting owner sync','note'));line.append(desc);const button=el('button',s.booking?.full?'Full':s.booking?.synced?'Book & pay':'Not on sale') as HTMLButtonElement;button.dataset.slot=s.id;button.disabled=busy||!s.booking?.synced||s.booking?.full;button.onclick=()=>book(s.id);line.append(button);$('#slots').append(line);$('#staff-slots').append(el('p',`${s.data.label} · ${s.data.capacity} seat(s) · ${s.booking?.synced?'Synced':'Awaiting sync'}`));}
 if(!slotRows.length)$('#slots').append(el('p','No slots published yet. Please check back.'));
 $('#tracking').hidden=!ticket;
 const mine=rows.find(r=>r.id===ticket);$('#my-ticket').textContent=mine?`${mine.data.state==='confirmed'?'Paid — seat secured':mine.data.state==='pending'?'Pending payment — seat not reserved':'Released'} · ${label(mine.data.slot)} · #${mine.id.slice(-6)}`:'Booking not found. Check the reference or try again.';
 ($('#receipt') as HTMLAnchorElement).href=publicLink(ticket);
 if(role==='staff'){
 $('#moves').replaceChildren();
 for(const row of rows.filter(r=>r.data.state==='confirmed')){const line=el('article');line.dataset.move=row.id;line.append(el('span',`#${row.id.slice(-6)} · ${label(row.data.slot)} · v${row.version}`));const select=el('select') as HTMLSelectElement;select.setAttribute('aria-label','Move booking to');for(const s of slotRows.filter(s=>s.id!==row.data.slot)){const o=el('option',s.data.label) as HTMLOptionElement;o.value=s.id;select.append(o);}const btn=el('button','Move booking') as HTMLButtonElement;btn.disabled=!select.options.length;btn.onclick=async()=>{btn.disabled=true;try{await bookings.update(row,{slot:select.value});$('#notice').textContent='Booking moved. Owner AI: review and sync both affected links before more sales.';}catch(e){$('#notice').textContent=`Move refused: ${(e as Error).message}. Current record reloaded; choose again.`;}await refresh();};line.append(select,btn);$('#moves').append(line);}
 }
}
async function refresh(){try{[slotRows,rows]=await Promise.all([slots.list(),bookings.list()]);$('#connection').textContent='● Live workshop';paint();}catch(e){$('#connection').textContent='Reconnecting';$('#notice').textContent=(e as Error).message;}}
async function book(slot:string){busy=true;paint();$('#notice').textContent='Opening secure Stripe payment…';try{const r=await shop.book('full-tune',{collection:'bookings',slot});if(!r.ok||!r.booking)throw Error(r.error||'Payment could not open. Please retry.');ticket=r.booking;try{localStorage.setItem('coldsmoke-ticket',ticket);}catch{} parent.postMessage({type:'homie-app-ticket',ticket},'*');$('#notice').textContent='Pending payment. Save your tracking link; your seat is secured only when paid.';}catch(e){$('#notice').textContent=(e as Error).message;}finally{busy=false;await refresh();}}
$('#publish').onsubmit=async(e)=>{e.preventDefault();try{await slots.create({label:( $('#slot-label') as HTMLInputElement).value.trim(),capacity:Number(($('#capacity') as HTMLInputElement).value)},($('#slot-id') as HTMLInputElement).value);$('#publish-status').textContent='Published. Owner AI: sync slots to enable payment.';await refresh();}catch(e){$('#publish-status').textContent=(e as Error).message;}};
$('#find').onclick=()=>{ticket=($('#reference') as HTMLInputElement).value.trim();paint();};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(publicLink(ticket));$('#notice').textContent='Tracking link copied.';}catch{$('#notice').textContent='Copy the tracking link shown above to save it.';}};
setInterval(refresh,2000);void refresh();
