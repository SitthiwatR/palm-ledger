export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2);
export const money = value => new Intl.NumberFormat('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2}).format(value/100);
export function minor(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('กรอกจำนวนเงินเป็นตัวเลขบวก ทศนิยมไม่เกิน 2 ตำแหน่ง');
  const n=Math.round(Number(value)*100);
  if (!Number.isSafeInteger(n) || n>99999999999) throw new Error('จำนวนเงินสูงเกินไป');
  return n;
}
export function quantityTotal(quantity, rate, divisor=1) {
  const q=Number(quantity);
  if(!Number.isFinite(q)||q<=0||q>100000000)throw new Error('กรอกจำนวนให้มากกว่า 0');
  return Math.round(q*minor(rate)/divisor);
}
export function recordCheck(r, gardens) {
  if(!['income','expense'].includes(r.kind))throw new Error('ประเภทรายการไม่ถูกต้อง');
  if(!gardens.some(g=>g.id===r.garden)&&r.garden!=='shared')throw new Error('เลือกสวนก่อนบันทึก');
  if(!r.title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||Number.isNaN(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date)throw new Error('กรอกชื่อรายการและวันที่ให้ครบ');
  if(!Number.isSafeInteger(r.amount)||r.amount<=0||!Number.isSafeInteger(r.paid)||r.paid<0||r.paid>r.amount)throw new Error('ยอดจ่ายต้องอยู่ระหว่าง 0 ถึงยอดเต็ม');
  if(r.kind==='income'&&r.paid!==r.amount)throw new Error('รายรับต้องรับเต็มจำนวน');
  return r;
}
export function summarize(state,garden=null,from='',to='') {
  const records=state.records.filter(r=>(!garden||r.garden===garden)&&(!from||r.date>=from)&&(!to||r.date<=to));
  const income=records.filter(r=>r.kind==='income').reduce((s,r)=>s+r.amount,0);
  const expense=records.filter(r=>r.kind==='expense'&&!r.opening).reduce((s,r)=>s+r.amount,0);
  const pending=records.filter(r=>r.kind==='expense').reduce((s,r)=>s+r.amount-r.paid,0);
  const opening=state.gardens.filter(g=>!garden||g.id===garden).reduce((s,g)=>s+g.opening,0);
  return {income,expense,pending,opening,net:income-expense+(!from&&!to?opening:0)};
}
export function addPayment(r,amount,date) {
  if(!Number.isSafeInteger(amount)||amount<=0||amount>r.amount-r.paid)throw new Error('ยอดจ่ายต้องมากกว่า 0 และไม่เกินยอดค้าง');
  return {...r,paid:r.paid+amount,payments:[...(r.payments||[]),{amount,date}]};
}
export function allocateRecord(state,recordId,allocations) {
  const source=state.records.find(r=>r.id===recordId);
  if(!source||source.garden!=='shared'||source.opening)throw new Error('เลือกค่าใช้จ่ายส่วนกลาง');
  const active=allocations.filter(a=>a.amount>0);
  if(!active.length||active.some(a=>!Number.isSafeInteger(a.amount)||!state.gardens.some(g=>g.id===a.garden))||active.reduce((s,a)=>s+a.amount,0)!==source.amount)throw new Error('ยอดที่แบ่งต้องรวมเท่ากับยอดเต็ม');
  let used=0, cumulative=0;
  const copies=active.map((a,index)=>{
    cumulative+=a.amount;
    const target=index===active.length-1?source.paid:Math.round(source.paid*cumulative/source.amount);
    const paid=target-used; used=target;
    return {...source,id:id(),garden:a.garden,amount:a.amount,paid,payments:[],note:[source.note,'แบ่งจากส่วนกลาง; จ่ายแล้ว ณ วันแบ่ง '+money(paid)+' บาท'].filter(Boolean).join('\n'),allocatedFrom:source.id};
  });
  return {...state,records:[...state.records.filter(r=>r.id!==source.id),...copies]};
}
export function demoState() {
  const record=(key,garden,kind,title,amount,paid,category,date='2026-10-18')=>({id:key,garden,kind,title,amount:amount*100,paid:paid*100,category,date,party:'',note:'ข้อมูลตัวอย่าง',payments:[]});
  return {version:1,demo:true,gardens:[{id:'home',name:'สวนบ้าน',opening:0},{id:'canal',name:'สวนคลอง',opening:0}],records:[
    record('sale1','home','income','ขายปาล์ม',48000,48000,'sale'),record('fert1','home','expense','ปุ๋ย 4 กระสอบ × 800 บาท',3200,3200,'fertilizer'),record('wage1','home','expense','ค่าแรงทีมเก็บเกี่ยว',16800,12600,'production'),
    record('sale2','canal','income','ขายปาล์ม',30000,30000,'sale'),record('fert2','canal','expense','ปุ๋ย 10 กระสอบ × 800 บาท',8000,8000,'fertilizer'),record('wage2','canal','expense','ค่าแรงรายวัน',5200,3200,'daily'),record('repair2','canal','expense','ซ่อมเครื่องตัดหญ้า',2000,2000,'maintenance')
  ]};
}
export function validateState(s) {
  if(!s||s.version!==1||typeof s.demo!=='boolean'||!Array.isArray(s.gardens)||!s.gardens.length||!Array.isArray(s.records))throw new Error('ไฟล์ข้อมูลไม่ถูกต้อง');
  const ids=new Set();
  for(const g of s.gardens){if(typeof g.id!=='string'||g.id==='shared'||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||!Number.isSafeInteger(g.opening))throw new Error('ข้อมูลสวนไม่ถูกต้อง');ids.add(g.id);}
  const rids=new Set();
  s.records.forEach(r=>{if(typeof r.id!=='string'||rids.has(r.id)||typeof r.title!=='string'||typeof r.date!=='string')throw new Error('ข้อมูลรายการไม่ถูกต้อง');rids.add(r.id);recordCheck(r,s.gardens);if(r.photo&&(typeof r.photo!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(r.photo)||r.photo.length>2800000))throw new Error('ไฟล์รูปไม่รองรับ');if(r.payments&&(!Array.isArray(r.payments)||r.payments.some(p=>!p||!Number.isSafeInteger(p.amount)||p.amount<=0||typeof p.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||Number.isNaN(Date.parse(p.date)))||r.payments.reduce((sum,p)=>sum+p.amount,0)>r.paid))throw new Error('ประวัติการจ่ายไม่ถูกต้อง');});
  return s;
}
