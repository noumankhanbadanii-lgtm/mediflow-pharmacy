export const SCHEMA_VERSION = 1;
const arrays = ['medicines','batches','sales','purchases','customers','suppliers','payments','expenses','returns','adjustments','audit'];
export function initialState() {
  return {schemaVersion:SCHEMA_VERSION,settings:{name:'MediFlow Medical Store',currency:'PKR',address:'',phone:'',license:'',taxRate:0,receiptFooter:'Thank you for choosing us. Get well soon.'},...Object.fromEntries(arrays.map(k=>[k,[]])),_requests:[]};
}
const fail = message => { throw new Error(message); };
export const money = n => Math.round((Number(n)+Number.EPSILON)*100)/100;
const text = (v,label,max=200,required=false) => { if(v==null) v=''; if(typeof v!=='string') fail(`${label} must be text.`); v=v.trim(); if(required&&!v) fail(`${label} is required.`); if(v.length>max) fail(`${label} is too long (maximum ${max} characters).`); return v; };
const num = (v,label,min=0,max=100000000) => { const n=Number(v); if(v===''||v==null||!Number.isFinite(n)||n<min||n>max) fail(`${label} must be between ${min} and ${max}.`); return money(n); };
const integer = (v,label,min=0,max=1000000) => { const n=Number(v); if(v===''||v==null||!Number.isSafeInteger(n)||n<min||n>max) fail(`${label} must be a whole number between ${min} and ${max}.`); return n; };
const date = (v,label='Expiry date') => { const d=text(v,label,10,true); if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d) fail(`${label} must be a valid date.`); return d; };
const get = (list,id,label) => list.find(x=>x.id===id)||fail(`${label} was not found.`);
const payMethod = v => { const m=text(v||'Cash','Payment method',30); if(!['Cash','Card','Bank','Credit','Easypaisa','JazzCash'].includes(m)) fail('Choose a valid payment method.'); return m; };
const items = v => { if(!Array.isArray(v)||!v.length||v.length>200) fail('Add between 1 and 200 items.'); return v; };
const sum = (a,fn) => money(a.reduce((s,x)=>s+fn(x),0));
export const customerBalance = (s,id) => money((s.customers.find(c=>c.id===id)?.openingBalance||0)+sum(s.sales.filter(x=>x.customerId===id),x=>x.total-x.paid)-sum(s.returns.filter(x=>x.customerId===id),x=>x.creditApplied||0)-sum(s.payments.filter(x=>x.partyType==='customer'&&x.partyId===id),x=>x.amount));
export const supplierBalance = (s,id) => money((s.suppliers.find(c=>c.id===id)?.openingBalance||0)+sum(s.purchases.filter(x=>x.supplierId===id),x=>x.total-x.paid)-sum(s.payments.filter(x=>x.partyType==='supplier'&&x.partyId===id),x=>x.amount));
function receiptNumber(s,kind,now){ const prefix=kind==='sale'?'INV':'PUR';const arr=kind==='sale'?s.sales:s.purchases;return `${prefix}-${now.slice(0,10).replaceAll('-','')}-${String(arr.length+1).padStart(4,'0')}`; }
function party(s,p,type,id){
 const list=type==='customer'?s.customers:s.suppliers;
 const existing=p.id?get(list,p.id,type==='customer'?'Customer':'Supplier'):null;
 const value={id:existing?.id||id(),name:text(p.name,'Name',120,true),phone:text(p.phone,'Phone',40),address:text(p.address,'Address',300),openingBalance:num(p.openingBalance??existing?.openingBalance??0,'Opening balance')};
 if(existing && value.openingBalance!==existing.openingBalance && (s.sales.some(x=>x.customerId===existing.id)||s.purchases.some(x=>x.supplierId===existing.id)||s.payments.some(x=>x.partyId===existing.id))) fail('Opening balance cannot be changed after transactions. Record a payment instead.');
 if(existing) Object.assign(existing,value); else list.push(value);return value;
}
function addBatch(s,p,id,allowZero=false){
 const medicine=get(s.medicines,p.medicineId,'Medicine');
 const batchNo=text(p.batchNo,'Batch number',60,true),expiry=date(p.expiry),qty=integer(p.qty,'Quantity',allowZero?0:1),cost=num(p.cost,'Cost price'),price=num(p.price,'Selling price');
 const existing=s.batches.find(b=>b.medicineId===medicine.id&&b.batchNo.toLowerCase()===batchNo.toLowerCase()&&b.expiry===expiry);
 if(existing){ if(existing.cost!==cost||existing.price!==price)fail('This batch already exists with different prices. Use a new batch number or the original prices.'); existing.qty+=qty; if(existing.qty>1000000)fail('Batch quantity is too large.'); return existing; }
 const b={id:id(),medicineId:medicine.id,batchNo,expiry,qty,cost,price};s.batches.push(b);return b;
}
function returnAmounts(sale,prior,lines){
 const subtotal=sum(lines,l=>l.qty*l.price),priorSubtotal=sum(prior,r=>r.subtotal??sum(r.items,l=>l.qty*l.price));
 const isFinal=sale.items.every(l=>prior.flatMap(r=>r.items).filter(x=>x.batchId===l.batchId).reduce((n,x)=>n+x.qty,0)+(lines.find(x=>x.batchId===l.batchId)?.qty||0)===l.qty);
 const cumulativeSubtotal=money(priorSubtotal+subtotal);
 const cumulativeDiscount=isFinal?sale.discount:(sale.subtotal?money(sale.discount*cumulativeSubtotal/sale.subtotal):0);
 const cumulativeTax=isFinal?sale.tax:(sale.subtotal?money(sale.tax*cumulativeSubtotal/sale.subtotal):0);
 const discount=money(cumulativeDiscount-sum(prior,r=>r.discount||0));const tax=money(cumulativeTax-sum(prior,r=>r.tax||0));
 const total=isFinal?money(sale.total-sum(prior,r=>r.total)):money(subtotal-discount+tax);
 let assigned=0,cumulative=0;
 for(let i=0;i<lines.length;i++){cumulative=money(cumulative+lines[i].qty*lines[i].price);const target=i===lines.length-1?total:(subtotal?money(total*cumulative/subtotal):0);lines[i].lineTotal=money(target-assigned);assigned=target;}
 return {subtotal,discount,tax,total};
}
function sameMoney(actual,expected,label){if(Math.abs(actual-expected)>0.001)fail(`Invalid backup: ${label} does not match its items.`);}
function timestamp(value,label){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail(`Invalid backup: ${label} date.`);return value;}
function validateBackup(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.schemaVersion!==SCHEMA_VERSION)fail('This is not a supported MediFlow backup.');
 const s=structuredClone(raw);
 for(const k of arrays)if(!Array.isArray(s[k])||s[k].length>20000)fail(`Invalid backup: ${k}.`);
 if(!s.settings||typeof s.settings!=='object')fail('Invalid backup settings.');
 s.settings={name:text(s.settings.name,'Store name',120,true),currency:'PKR',address:text(s.settings.address,'Address',300),phone:text(s.settings.phone,'Phone',40),license:text(s.settings.license,'License',80),taxRate:num(s.settings.taxRate??0,'Tax rate',0,100),receiptFooter:text(s.settings.receiptFooter,'Receipt footer',250)};
 for(const k of arrays){const seen=new Set();for(const x of s[k]){if(!x||typeof x!=='object')fail(`Invalid backup: ${k}.`);x.id=text(x.id,'Record ID',100,true);if(seen.has(x.id))fail(`Duplicate ID in backup ${k}.`);seen.add(x.id);}}
 const medicineIds=new Set(s.medicines.map(x=>x.id));const batchIds=new Set(s.batches.map(x=>x.id));const customerIds=new Set(s.customers.map(x=>x.id));const supplierIds=new Set(s.suppliers.map(x=>x.id));
 for(const m of s.medicines){m.name=text(m.name,'Medicine name',160,true);m.generic=text(m.generic,'Generic',160);m.barcode=text(m.barcode,'Barcode',100);m.unit=text(m.unit,'Unit',30,true);m.category=text(m.category,'Category',80);m.manufacturer=text(m.manufacturer,'Manufacturer',120);m.shelf=text(m.shelf,'Shelf',40);m.reorderLevel=integer(m.reorderLevel,'Reorder level');m.rx=!!m.rx;}
 const codes=s.medicines.map(m=>m.barcode).filter(Boolean);if(new Set(codes).size!==codes.length)fail('Backup contains duplicate barcodes.');
 const batchKeys=new Set();for(const b of s.batches){if(!medicineIds.has(b.medicineId))fail('Backup batch medicine is missing.');b.batchNo=text(b.batchNo,'Batch number',60,true);b.expiry=date(b.expiry);b.qty=integer(b.qty,'Batch quantity');b.cost=num(b.cost,'Cost');b.price=num(b.price,'Price');const key=`${b.medicineId}|${b.batchNo.toLowerCase()}|${b.expiry}`;if(batchKeys.has(key))fail('Backup contains duplicate stock batches.');batchKeys.add(key);}
 for(const k of ['customers','suppliers'])for(const p of s[k]){p.name=text(p.name,'Name',120,true);p.phone=text(p.phone,'Phone',40);p.address=text(p.address,'Address',300);p.openingBalance=num(p.openingBalance,'Opening balance');}
 for(const k of ['sales','purchases']){const numbers=new Set(),supplierInvoices=new Set();for(const invoice of s[k]){
   const isSale=k==='sales';if(isSale&&invoice.customerId&&!customerIds.has(invoice.customerId))fail('Backup sale customer is missing.');if(!isSale&&!supplierIds.has(invoice.supplierId))fail('Backup purchase supplier is missing.');
   invoice.number=text(invoice.number,'Invoice number',100,true);if(numbers.has(invoice.number))fail('Backup contains duplicate invoice numbers.');numbers.add(invoice.number);timestamp(invoice.createdAt,'Invoice');invoice.method=payMethod(invoice.method);
   if(!isSale){invoice.invoiceNo=text(invoice.invoiceNo,'Supplier invoice',80,true);const key=`${invoice.supplierId}|${invoice.invoiceNo.toLowerCase()}`;if(supplierInvoices.has(key))fail('Backup contains a duplicate supplier invoice.');supplierInvoices.add(key);}
   const seen=new Set();for(const l of items(invoice.items)){if(!batchIds.has(l.batchId)||!medicineIds.has(l.medicineId))fail('Backup invoice item is missing.');if(seen.has(l.batchId))fail('Backup contains duplicate invoice batch lines.');seen.add(l.batchId);const b=get(s.batches,l.batchId,'Batch');if(b.medicineId!==l.medicineId)fail('Backup invoice medicine does not match its batch.');l.qty=integer(l.qty,'Invoice quantity',1);l.price=num(l.price,'Invoice price');l.cost=num(l.cost,'Invoice cost');l.lineTotal=num(l.lineTotal,'Line total');sameMoney(l.lineTotal,money(l.qty*(isSale?l.price:l.cost)),'Invoice line total');if(l.unit&&l.unit!==get(s.medicines,l.medicineId,'Medicine').unit)fail('Backup invoice sale unit does not match the medicine.');}
   for(const f of ['subtotal','discount','tax','total','paid'])invoice[f]=num(invoice[f]??0,`Invoice ${f}`);invoice.taxRate=num(invoice.taxRate??0,'Invoice tax rate',0,100);
   sameMoney(invoice.subtotal,sum(invoice.items,l=>l.lineTotal),'Invoice subtotal');if(invoice.discount>invoice.subtotal)fail('Backup invoice discount exceeds subtotal.');sameMoney(invoice.tax,money((invoice.subtotal-invoice.discount)*invoice.taxRate/100),'Invoice tax');sameMoney(invoice.total,money(invoice.subtotal-invoice.discount+invoice.tax),'Invoice total');if(invoice.paid>invoice.total)fail('Backup payment exceeds invoice total.');if(isSale&&invoice.paid<invoice.total&&!invoice.customerId)fail('Backup credit sale has no customer.');if(isSale&&invoice.method==='Credit'&&invoice.paid>0)fail('Backup credit sale has an invalid payment method.');
 }}
 for(const p of s.payments){if(!['customer','supplier'].includes(p.partyType)||(p.partyType==='customer'?!customerIds.has(p.partyId):!supplierIds.has(p.partyId)))fail('Backup payment party is missing.');p.amount=num(p.amount,'Payment amount',0.01);p.method=payMethod(p.method);if(p.method==='Credit')fail('Backup payment method is invalid.');timestamp(p.createdAt,'Payment');}
 const checkedReturns=[];for(const r of s.returns){const sale=get(s.sales,r.saleId,'Backup original invoice');if(r.customerId!==sale.customerId)fail('Backup return customer does not match the invoice.');timestamp(r.createdAt,'Return');if(!['restock','quarantine'].includes(r.disposition))fail('Backup return disposition is invalid.');const prior=checkedReturns.filter(x=>x.saleId===sale.id);const seen=new Set();
   for(const l of items(r.items)){const sold=sale.items.find(x=>x.batchId===l.batchId);if(!sold)fail('Backup return item was not sold on this invoice.');if(seen.has(l.batchId))fail('Backup contains duplicate return lines.');seen.add(l.batchId);l.qty=integer(l.qty,'Return quantity',1);const already=prior.flatMap(x=>x.items).filter(x=>x.batchId===l.batchId).reduce((n,x)=>n+x.qty,0);if(l.qty+already>sold.qty)fail('Backup return quantity exceeds the original sale.');if(l.medicineId!==sold.medicineId)fail('Backup return medicine does not match the invoice.');l.price=num(l.price,'Return price');l.cost=num(l.cost,'Return cost');sameMoney(l.price,sold.price,'Return price');sameMoney(l.cost,sold.cost,'Return cost');if(!['restock','quarantine'].includes(l.disposition))fail('Backup return item disposition is invalid.');if(l.disposition==='restock'&&get(s.batches,l.batchId,'Batch').expiry<r.createdAt.slice(0,10))fail('Backup contains an expired item returned to saleable stock.');l.lineTotal=num(l.lineTotal,'Return line total');}
   const expectedLines=structuredClone(r.items);const expected=returnAmounts(sale,prior,expectedLines);for(const f of ['total','refund','creditApplied'])r[f]=num(r[f]??0,`Return ${f}`);for(const f of ['subtotal','discount','tax'])r[f]=num(r[f]??expected[f],`Return ${f}`);for(const f of ['subtotal','discount','tax','total'])sameMoney(r[f],expected[f],`Return ${f}`);sameMoney(sum(r.items,l=>l.lineTotal),r.total,'Return line totals');sameMoney(money(r.refund+r.creditApplied),r.total,'Return refund and credit');const outstanding=money(sale.total-sale.paid-sum(prior,x=>x.creditApplied));if(r.creditApplied>outstanding||(!sale.customerId&&r.creditApplied>0))fail('Backup return credit exceeds unpaid invoice balance.');checkedReturns.push(r);
 }
 for(const e of s.expenses){e.amount=num(e.amount,'Expense amount',0.01);e.category=text(e.category,'Expense category',80,true);e.date=date(e.date,'Expense date');timestamp(e.createdAt,'Expense');}
 for(const a of s.adjustments){if(!batchIds.has(a.batchId))fail('Backup adjustment batch is missing.');a.qtyChange=integer(a.qtyChange,'Adjustment quantity',-1000000,1000000);if(a.qtyChange===0)fail('Backup stock adjustment cannot be zero.');a.reason=text(a.reason,'Adjustment reason',300,true);timestamp(a.createdAt,'Adjustment');}
 for(const c of s.customers)if(customerBalance(s,c.id)<-0.001)fail('Backup contains an invalid customer balance.');for(const p of s.suppliers)if(supplierBalance(s,p.id)<-0.001)fail('Backup contains an invalid supplier balance.');
 s._requests=[];return s;
}
export function reduceAction(original,type,payload={},options={}){
 let s=structuredClone(original); const p=payload??{};const now=options.now||new Date().toISOString();const today=now.slice(0,10);const id=options.id||(()=>crypto.randomUUID());let result;
 if(!p||typeof p!=='object'||Array.isArray(p))fail('Action data is invalid.');
 switch(type){
 case 'saveMedicine':{
   const existing=p.id?get(s.medicines,p.id,'Medicine'):null; const barcode=text(p.barcode,'Barcode',100);
   if(barcode&&s.medicines.some(m=>m.barcode===barcode&&m.id!==existing?.id))fail('This barcode belongs to another medicine.');
   const m={id:existing?.id||id(),name:text(p.name,'Medicine name',160,true),generic:text(p.generic,'Generic / salt',160),category:text(p.category||'General','Category',80),manufacturer:text(p.manufacturer,'Manufacturer',120),barcode,unit:text(p.unit||'Tablet','Unit',30,true),reorderLevel:integer(p.reorderLevel??10,'Reorder level'),rx:!!p.rx,shelf:text(p.shelf,'Shelf',40)};
   if(existing&&existing.unit!==m.unit&&s.batches.some(b=>b.medicineId===m.id))fail('Sale unit cannot be changed after stock has been added. Create a separate medicine.');
   if(existing)Object.assign(existing,m);else s.medicines.push(m);result=m;break;
 }
 case 'addBatch':{
   const b=addBatch(s,p,id);s.adjustments.push({id:id(),batchId:b.id,qtyChange:Number(p.qty),reason:'Opening stock',createdAt:now});result=b;break;
 }
 case 'saveCustomer':result=party(s,p,'customer',id);break;
 case 'saveSupplier':result=party(s,p,'supplier',id);break;
 case 'checkout':{
   const customer=p.customerId?get(s.customers,p.customerId,'Customer'):null;const batchSeen=new Set();
   const lines=items(p.items).map(l=>{if(batchSeen.has(l.batchId))fail('Combine duplicate batches into one sale line.');batchSeen.add(l.batchId);const b=get(s.batches,l.batchId,'Batch');const m=get(s.medicines,b.medicineId,'Medicine');const qty=integer(l.qty,'Sale quantity',1);if(b.expiry<today)fail(`${m.name} batch ${b.batchNo} is expired and cannot be sold.`);if(qty>b.qty)fail(`Only ${b.qty} ${m.unit.toLowerCase()}(s) of ${m.name} are available in this batch.`);return {batchId:b.id,medicineId:m.id,name:m.name,unit:m.unit,batchNo:b.batchNo,expiry:b.expiry,qty,price:b.price,cost:b.cost,lineTotal:money(qty*b.price)};});
   const subtotal=sum(lines,l=>l.lineTotal),discount=num(p.discount??0,'Discount',0,subtotal),taxRate=num(p.taxRate??s.settings.taxRate??0,'Tax rate',0,100),tax=money((subtotal-discount)*taxRate/100),total=money(subtotal-discount+tax),method=payMethod(p.method);
   const tendered=num(p.paid??(method==='Credit'?0:total),'Amount received');const paid=Math.min(tendered,total),change=money(tendered-paid);if(paid<total&&!customer)fail('Select a customer for a credit or partially paid sale.');
   if(method==='Credit'&&paid>0)fail('For a payment received, select Cash, Card or Bank.');
   const sale={id:id(),number:receiptNumber(s,'sale',now),createdAt:now,customerId:customer?.id||null,customerName:customer?.name||'Walk-in customer',items:lines,subtotal,discount,taxRate,tax,total,paid,tendered,change,method,notes:text(p.notes,'Notes',500)};
   for(const l of lines)get(s.batches,l.batchId,'Batch').qty-=l.qty;s.sales.push(sale);result=sale;break;
 }
 case 'receivePurchase':{
   const supplier=get(s.suppliers,p.supplierId,'Supplier');const invoiceNo=text(p.invoiceNo,'Supplier invoice',80,true);
   if(s.purchases.some(x=>x.supplierId===supplier.id&&x.invoiceNo.toLowerCase()===invoiceNo.toLowerCase()))fail('This supplier invoice has already been received.');
   const lineSeen=new Set();const lines=items(p.items).map(l=>{const m=get(s.medicines,l.medicineId,'Medicine');const qty=integer(l.qty,'Purchase quantity',1),cost=num(l.cost,'Cost price'),price=num(l.price,'Selling price'),expiry=date(l.expiry),batchNo=text(l.batchNo,'Batch number',60,true);const key=`${m.id}|${batchNo.toLowerCase()}|${expiry}`;if(lineSeen.has(key))fail('Combine duplicate purchase batches into one line.');lineSeen.add(key);const b=addBatch(s,{medicineId:m.id,batchNo,expiry,qty,cost,price},id);return {batchId:b.id,medicineId:m.id,name:m.name,unit:m.unit,batchNo,expiry,qty,cost,price,lineTotal:money(qty*cost)};});
   const subtotal=sum(lines,l=>l.lineTotal),discount=num(p.discount??0,'Purchase discount',0,subtotal),taxRate=num(p.taxRate??0,'Purchase tax rate',0,100),tax=money((subtotal-discount)*taxRate/100),total=money(subtotal-discount+tax),paid=num(p.paid??0,'Paid amount',0,total);
   const purchase={id:id(),number:receiptNumber(s,'purchase',now),invoiceNo,createdAt:now,supplierId:supplier.id,supplierName:supplier.name,items:lines,subtotal,discount,taxRate,tax,total,paid,method:payMethod(p.method||'Cash'),notes:text(p.notes,'Notes',500)};s.purchases.push(purchase);result=purchase;break;
 }
 case 'payment':{
   if(!['customer','supplier'].includes(p.partyType))fail('Choose a customer or supplier.');const party=get(p.partyType==='customer'?s.customers:s.suppliers,p.partyId,p.partyType==='customer'?'Customer':'Supplier');const amount=num(p.amount,'Payment amount',0.01),balance=p.partyType==='customer'?customerBalance(s,party.id):supplierBalance(s,party.id);if(amount>balance)fail(`Payment exceeds the outstanding balance of PKR ${balance.toFixed(2)}.`);
   const payment={id:id(),partyType:p.partyType,partyId:party.id,partyName:party.name,amount,method:payMethod(p.method),notes:text(p.notes,'Reference / notes',500),createdAt:now};if(payment.method==='Credit')fail('Select the method used to receive or send payment.');s.payments.push(payment);result=payment;break;
 }
 case 'addExpense':{
   const e={id:id(),category:text(p.category||'Other','Category',80,true),amount:num(p.amount,'Expense amount',0.01),notes:text(p.notes,'Notes',500),date:date(p.date||today,'Expense date'),createdAt:now};s.expenses.push(e);result=e;break;
 }
 case 'saleReturn':{
   const sale=get(s.sales,p.saleId,'Original invoice');const prior=s.returns.filter(x=>x.saleId===sale.id);const seen=new Set();const disposition=p.disposition||'quarantine';if(!['restock','quarantine'].includes(disposition))fail('Choose restock or quarantine.');
   const lines=items(p.items).map(l=>{if(seen.has(l.batchId))fail('Combine duplicate return items.');seen.add(l.batchId);const sold=sale.items.find(x=>x.batchId===l.batchId);if(!sold)fail('This item was not on the original invoice.');const qty=integer(l.qty,'Return quantity',1);const returned=prior.reduce((n,r)=>n+r.items.filter(x=>x.batchId===l.batchId).reduce((n,x)=>n+x.qty,0),0);if(qty>sold.qty-returned)fail(`Only ${sold.qty-returned} unit(s) of ${sold.name} can still be returned.`);const batch=get(s.batches,l.batchId,'Original batch');const canRestock=disposition==='restock'&&batch.expiry>=today;const raw=money(sold.price*qty);const adjusted=sale.subtotal?money(raw*sale.total/sale.subtotal):0;return {...sold,qty,lineTotal:adjusted,disposition:canRestock?'restock':'quarantine'};});
   const {subtotal,discount,tax,total}=returnAmounts(sale,prior,lines);
   const outstanding=money(Math.max(0,sale.total-sale.paid-sum(prior,r=>r.creditApplied||0)));const customerDue=sale.customerId?Math.max(0,customerBalance(s,sale.customerId)):0;const creditApplied=money(Math.min(total,outstanding,customerDue));const refund=money(total-creditApplied);
   const r={id:id(),number:`RET-${String(s.returns.length+1).padStart(5,'0')}`,saleId:sale.id,saleNumber:sale.number,customerId:sale.customerId,customerName:sale.customerName,createdAt:now,items:lines,subtotal,discount,tax,total,creditApplied,refund,disposition,notes:text(p.notes,'Return reason',500,true)};
   for(const l of lines)if(l.disposition==='restock'){get(s.batches,l.batchId,'Batch').qty+=l.qty;}
   s.returns.push(r);result=r;break;
 }
 case 'adjustStock':{
   const batch=get(s.batches,p.batchId,'Batch');const qtyChange=integer(p.qtyChange,'Stock change',-1000000,1000000);if(qtyChange===0)fail('Stock change cannot be zero.');if(batch.qty+qtyChange<0)fail('Adjustment would make stock negative.');if(batch.qty+qtyChange>1000000)fail('Stock quantity is too large.');const a={id:id(),batchId:batch.id,qtyChange,reason:text(p.reason,'Adjustment reason',300,true),createdAt:now};batch.qty+=qtyChange;s.adjustments.push(a);result=a;break;
 }
 case 'settings':{
   s.settings={name:text(p.name,'Store name',120,true),currency:'PKR',address:text(p.address,'Address',300),phone:text(p.phone,'Phone',40),license:text(p.license,'License',80),taxRate:num(p.taxRate??0,'Tax rate',0,100),receiptFooter:text(p.receiptFooter,'Receipt footer',250)};result=s.settings;break;
 }
 case 'resetStore':{
   if(p.confirmation!=='RESET')fail('Type RESET to confirm clearing all store records.');const settings=s.settings;s=initialState();s.settings=settings;result={reset:true};break;
 }
 case 'restoreBackup':{
   if(p.confirmation!=='RESTORE')fail('Type RESTORE to confirm replacing current records.');s=validateBackup(p.state);result={restored:true};break;
 }
 case 'loadDemo':{
   if(s.medicines.length||s.sales.length||s.purchases.length||s.customers.length||s.suppliers.length||s.batches.length||s.expenses.length||s.payments.length)fail('Demo data can only be loaded into an empty store.');s=demoState(now,id);result={loaded:true};break;
 }
 default:fail('Unknown action.');
 }
 s.schemaVersion=SCHEMA_VERSION;s.audit.push({id:id(),type,createdAt:now,reference:result?.number||result?.name||result?.id||'',summary:type==='restoreBackup'?'Backup restored':type});
 return {state:s,result};
}
function demoState(now,id){
 const s=initialState();s.settings={...s.settings,name:'MediFlow Medical Store',address:'Main Market, Lahore',phone:'+92 300 1234567',license:'Demo — add your license'};
 const shift=days=>new Date(new Date(now).getTime()+days*86400000).toISOString().slice(0,10);
 const defs=[['Panadol 500mg','Paracetamol','Pain relief','GSK',12,8,'Tablet','A-01'],['Augmentin 625mg','Amoxicillin / Clavulanate','Antibiotics','GSK',85,64,'Tablet','A-02'],['Brufen 400mg','Ibuprofen','Pain relief','Abbott',18,12,'Tablet','A-01'],['Glucophage 500mg','Metformin','Diabetes','Merck',16,11,'Tablet','B-03'],['Risek 20mg','Omeprazole','Gastro care','Getz Pharma',28,19,'Capsule','B-01'],['Calpol 120mg/5ml','Paracetamol','Pediatric','GSK',180,132,'Bottle','C-01'],['Sofvasc 5mg','Amlodipine','Heart care','Getz Pharma',22,15,'Tablet','B-02'],['Rigix 10mg','Cetirizine','Allergy','AGP',14,9,'Tablet','A-03'],['ORS Sachet','Oral rehydration salts','First aid','Hilton',35,22,'Sachet','C-02'],['Ventolin Inhaler','Salbutamol','Respiratory','GSK',550,420,'Inhaler','C-03'],['Folic Acid 5mg','Folic acid','Vitamins','Abbott',6,3,'Tablet','B-04'],['Dettol 100ml','Chloroxylenol','First aid','Reckitt',210,160,'Bottle','C-04']];
 defs.forEach((d,i)=>{const m={id:id(),name:d[0],generic:d[1],category:d[2],manufacturer:d[3],barcode:String(896100000001+i),unit:d[6],reorderLevel:i===1?40:20,rx:[1,3,6,9].includes(i),shelf:d[7]};s.medicines.push(m);s.batches.push({id:id(),medicineId:m.id,batchNo:`MF-${String(i+1).padStart(3,'0')}A`,expiry:shift(i===4?35:i===7?60:240+i*20),qty:i===1?26:i===9?8:80+i*13,cost:d[5],price:d[4]});});
 for(const [i,qty,days]of[[0,220,400],[2,45,25],[10,30,-14]]){const b=s.batches[i];s.batches.push({...b,id:id(),batchNo:b.batchNo.replace('A','B'),qty,expiry:shift(days)});}
 const c1={id:id(),name:'Ahmed Khan',phone:'0300 7654321',address:'Model Town, Lahore',openingBalance:1500},c2={id:id(),name:'Sana Ali',phone:'0321 1234567',address:'Gulberg, Lahore',openingBalance:0};s.customers=[c1,c2];
 const sp1={id:id(),name:'Allied Pharma Distributors',phone:'042 35781234',address:'Shah Alam Market, Lahore',openingBalance:17500},sp2={id:id(),name:'City Medical Supply',phone:'0300 9876543',address:'Lahore',openingBalance:8200};s.suppliers=[sp1,sp2];
 for(let day=13;day>=0;day--){const at=new Date(new Date(now).getTime()-day*86400000);at.setUTCHours(10+(day%7),15,0,0);const b=s.batches[day%10],m=s.medicines.find(x=>x.id===b.medicineId);const qty=day%4+1;const total=money(b.price*qty);const credit=day===2||day===6;const sale={id:id(),number:`INV-${at.toISOString().slice(0,10).replaceAll('-','')}-${String(s.sales.length+1).padStart(4,'0')}`,createdAt:at.toISOString(),customerId:credit?c1.id:null,customerName:credit?c1.name:'Walk-in customer',items:[{batchId:b.id,medicineId:m.id,name:m.name,unit:m.unit,batchNo:b.batchNo,expiry:b.expiry,qty,price:b.price,cost:b.cost,lineTotal:total}],subtotal:total,discount:0,tax:0,taxRate:0,total,paid:credit?0:total,tendered:credit?0:total,change:0,method:credit?'Credit':'Cash',notes:'Sample invoice'};s.sales.push(sale);b.qty-=qty;}
 const pbatch=s.batches[0];s.purchases.push({id:id(),number:`PUR-${todayString(now)}-0001`,invoiceNo:'DEMO-2468',createdAt:new Date(new Date(now).getTime()-5*86400000).toISOString(),supplierId:sp1.id,supplierName:sp1.name,items:[{batchId:pbatch.id,medicineId:s.medicines[0].id,name:s.medicines[0].name,batchNo:pbatch.batchNo,expiry:pbatch.expiry,unit:'Tablet',qty:100,cost:pbatch.cost,price:pbatch.price,lineTotal:800}],subtotal:800,discount:0,tax:0,taxRate:0,total:800,paid:800,method:'Cash',notes:'Sample purchase included in opening stock'});
 s.expenses.push({id:id(),category:'Utilities',amount:1200,date:shift(-1),createdAt:now,notes:'Sample electricity expense'});s.audit.push({id:id(),type:'loadDemo',createdAt:now,reference:'Demo store',summary:'Sample records loaded'});return s;
}
const todayString=now=>now.slice(0,10).replaceAll('-','');
