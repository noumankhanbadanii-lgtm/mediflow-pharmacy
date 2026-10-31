import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceAction, customerBalance, supplierBalance } from '../domain.mjs';

const NOW = '2026-10-31T12:00:00.000Z';
let nextId = 0;
const context = () => ({ now: NOW, id: () => `test-${++nextId}` });
function act(state, type, payload = {}) {
  const output = reduceAction(state, type, payload, context());
  assert.ok(output && output.state, `${type} must return state`);
  return output.state;
}
function fixture() {
  let state = initialState();
  state = act(state, 'saveMedicine', {
    name: 'Test Paracetamol 500mg', generic: 'Paracetamol', category: 'Tablets',
    manufacturer: 'Test Labs', barcode: '123456789001', unit: 'tablet',
    reorderLevel: 10, rx: false, shelf: 'A-1',
  });
  const medicineId = state.medicines[0].id;
  state = act(state, 'saveSupplier', { name: 'Test Distributor', phone: '03001234567', address: 'Lahore', openingBalance: 0 });
  state = act(state, 'saveCustomer', { name: 'Test Customer', phone: '03007654321', address: 'Lahore', openingBalance: 0 });
  return { state, medicineId, supplierId: state.suppliers[0].id, customerId: state.customers[0].id };
}
function purchase(state, medicineId, supplierId, extra = {}) {
  return act(state, 'receivePurchase', {
    supplierId, invoiceNo: 'PUR-TEST-1', paid: 0,
    items: [{ medicineId, batchNo: 'B-2026', expiry: '2027-12-31', qty: 100, cost: 10, price: 20 }],
    ...extra,
  });
}

test('purchase, credit sale, collection and partial returns reconcile inventory and ledgers', () => {
  let { state, medicineId, supplierId, customerId } = fixture();
  state = purchase(state, medicineId, supplierId);
  assert.equal(state.batches[0].qty, 100);
  assert.equal(supplierBalance(state, supplierId), 1000);
  state = act(state, 'payment', { partyType: 'supplier', partyId: supplierId, amount: 400, method: 'Cash', notes: 'Part payment' });
  assert.equal(supplierBalance(state, supplierId), 600);
  const batchId = state.batches[0].id;
  state = act(state, 'checkout', { customerId, items: [{ batchId, qty: 10 }], discount: 0, taxRate: 0, paid: 50, method: 'Cash' });
  assert.equal(state.sales[0].total, 200);
  assert.equal(state.batches[0].qty, 90);
  assert.equal(customerBalance(state, customerId), 150);
  const saleId = state.sales[0].id;
  const originalSale = structuredClone(state.sales[0]);
  state = act(state, 'payment', { partyType: 'customer', partyId: customerId, amount: 60, method: 'Cash', notes: 'Collection' });
  assert.equal(customerBalance(state, customerId), 90);
  state = act(state, 'saleReturn', { saleId, items: [{ batchId, qty: 2 }], disposition: 'restock', notes: 'Unopened' });
  assert.equal(state.returns[0].total, 40);
  assert.equal(state.returns[0].creditApplied, 40);
  assert.equal(state.returns[0].refund, 0);
  assert.equal(customerBalance(state, customerId), 50);
  assert.equal(state.batches[0].qty, 92);
  state = act(state, 'payment', { partyType: 'customer', partyId: customerId, amount: 50, method: 'Cash' });
  assert.equal(customerBalance(state, customerId), 0);
  state = act(state, 'saleReturn', { saleId, items: [{ batchId, qty: 8 }], disposition: 'restock', notes: 'Remainder' });
  assert.equal(state.returns.at(-1).refund, 160);
  assert.equal(state.returns.at(-1).creditApplied, 0);
  assert.equal(customerBalance(state, customerId), 0);
  assert.equal(state.batches[0].qty, 100);
  assert.deepEqual(state.sales[0], originalSale, 'returns preserve the posted sale');
  assert.throws(() => act(state, 'saleReturn', { saleId, items: [{ batchId, qty: 1 }], disposition: 'restock' }));
});

test('expired stock is blocked while valid batches remain saleable', () => {
  let { state, medicineId } = fixture();
  state = act(state, 'addBatch', { medicineId, batchNo: 'EXPIRED', expiry: '2026-01-31', qty: 20, cost: 5, price: 10 });
  const batchId = state.batches[0].id;
  const before = structuredClone(state);
  assert.throws(() => act(state, 'checkout', { items: [{ batchId, qty: 1 }], paid: 10, discount: 0, taxRate: 0, method: 'Cash' }), /expir/i);
  assert.deepEqual(state, before, 'failed checkout cannot change stock or invoices');
});

test('overselling and duplicate batch lines cannot bypass stock checks', () => {
  let { state, medicineId, supplierId } = fixture();
  state = purchase(state, medicineId, supplierId);
  const batchId = state.batches[0].id;
  const before = structuredClone(state);
  assert.throws(() => act(state, 'checkout', { items: [{ batchId, qty: 101 }], paid: 2020, discount: 0, taxRate: 0, method: 'Cash' }));
  assert.throws(() => act(state, 'checkout', { items: [{ batchId, qty: 60 }, { batchId, qty: 60 }], paid: 2400, discount: 0, taxRate: 0, method: 'Cash' }));
  assert.deepEqual(state, before);
});

test('credit requires a customer and payments cannot exceed party balance', () => {
  let { state, medicineId, supplierId, customerId } = fixture();
  state = purchase(state, medicineId, supplierId);
  const batchId = state.batches[0].id;
  assert.throws(() => act(state, 'checkout', { items: [{ batchId, qty: 2 }], paid: 0, discount: 0, taxRate: 0, method: 'Credit' }));
  assert.throws(() => act(state, 'payment', { partyType: 'supplier', partyId: supplierId, amount: 1001, method: 'Cash' }));
  assert.throws(() => act(state, 'payment', { partyType: 'customer', partyId: customerId, amount: 1, method: 'Cash' }));
});

test('supplier invoice uniqueness and atomic purchase validation prevent duplicate stock', () => {
  let { state, medicineId, supplierId } = fixture();
  state = purchase(state, medicineId, supplierId);
  const before = structuredClone(state);
  assert.throws(() => purchase(state, medicineId, supplierId));
  assert.throws(() => purchase(state, medicineId, supplierId, {
    invoiceNo: 'PUR-BAD', items: [
      { medicineId, batchNo: 'GOOD', expiry: '2027-12-31', qty: 5, cost: 10, price: 20 },
      { medicineId, batchNo: 'BAD', expiry: 'not-a-date', qty: 5, cost: 10, price: 20 },
    ],
  }));
  assert.deepEqual(state, before);
});

test('quarantined returns refund correctly without restoring saleable quantity', () => {
  let { state, medicineId, supplierId } = fixture();
  state = purchase(state, medicineId, supplierId);
  const batchId = state.batches[0].id;
  state = act(state, 'checkout', { items: [{ batchId, qty: 5 }], paid: 100, discount: 0, taxRate: 0, method: 'Cash' });
  state = act(state, 'saleReturn', { saleId: state.sales[0].id, items: [{ batchId, qty: 2 }], disposition: 'quarantine', notes: 'Damaged seal' });
  assert.equal(state.batches[0].qty, 95);
  assert.equal(state.returns[0].refund, 40);
  assert.equal(state.returns[0].disposition, 'quarantine');
});

test('invalid quantities, amounts and negative stock adjustments are rejected', () => {
  let { state, medicineId, supplierId } = fixture();
  state = purchase(state, medicineId, supplierId);
  const batchId = state.batches[0].id;
  for (const qty of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => act(state, 'checkout', { items: [{ batchId, qty }], paid: 0, discount: 0, taxRate: 0, method: 'Cash' }));
  }
  for (const amount of [0, -10, NaN, Infinity]) {
    assert.throws(() => act(state, 'addExpense', { category: 'Rent', amount, notes: 'Invalid expense', date: '2026-10-31' }));
  }
  assert.throws(() => act(state, 'adjustStock', { batchId, qtyChange: -101, reason: 'Stock correction' }));
  assert.equal(state.batches[0].qty, 100);
});

test('demo loading is explicit and refuses to overwrite an existing store', () => {
  const empty = initialState();
  assert.equal(empty.medicines.length, 0);
  const demo = act(empty, 'loadDemo');
  assert.ok(demo.medicines.length >= 12);
  assert.ok(demo.batches.length >= 15);
  assert.throws(() => act(demo, 'loadDemo'));
  assert.throws(() => act(demo, 'not-an-action', {}));
});

test('taxed discounted partial returns reconcile tax, discount, revenue and gross profit', () => {
  let { state, medicineId } = fixture();
  state = act(state, 'addBatch', { medicineId, batchNo: 'ROUND', expiry: '2027-12-31', qty: 9, cost: 0.4, price: 0.99 });
  const batchId = state.batches[0].id;
  state = act(state, 'checkout', { items: [{ batchId, qty: 3 }], discount: 0.5, taxRate: 13, paid: 2.79, method: 'Cash' });
  const sale = state.sales[0];
  assert.equal(sale.subtotal, 2.97); assert.equal(sale.tax, 0.32); assert.equal(sale.total, 2.79);
  const rounded = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = (rows, key) => rounded(rows.reduce((n, x) => n + x[key], 0));
  for (let i = 0; i < 3; i++) {
    state = act(state, 'saleReturn', { saleId: sale.id, items: [{ batchId, qty: 1 }], disposition: 'restock', notes: 'Unopened return' });
    const r = state.returns.at(-1);
    assert.equal(rounded(r.subtotal - r.discount + r.tax), r.total);
    assert.equal(rounded(r.refund + r.creditApplied), r.total);
    const revenue = rounded(sale.total - sum(state.returns, 'total') - (sale.tax - sum(state.returns, 'tax')));
    const remainingCost = rounded((3 - state.returns.length) * 0.4);
    const expectedRevenue = rounded(sale.subtotal - sale.discount - (sum(state.returns, 'subtotal') - sum(state.returns, 'discount')));
    assert.equal(revenue, expectedRevenue, 'tax is excluded from net revenue');
    assert.equal(rounded(revenue - remainingCost), rounded(expectedRevenue - remainingCost), 'gross profit uses revenue without tax');
  }
  assert.equal(sum(state.returns, 'total'), sale.total);
  assert.equal(sum(state.returns, 'tax'), sale.tax);
  assert.equal(sum(state.returns, 'discount'), sale.discount);
  assert.equal(state.batches[0].qty, 9);
});

test('medicine sale unit becomes immutable when stock exists', () => {
  let { state, medicineId } = fixture();
  state = act(state, 'saveMedicine', { ...state.medicines[0], unit: 'Strip' });
  state = act(state, 'addBatch', { medicineId, batchNo: 'UNITS', expiry: '2027-12-31', qty: 4, cost: 10, price: 15 });
  const before = structuredClone(state);
  assert.throws(() => act(state, 'saveMedicine', { ...state.medicines[0], unit: 'Tablet' }), /Sale unit cannot be changed/);
  assert.deepEqual(state, before);
  state = act(state, 'saveMedicine', { ...state.medicines[0], name: 'Updated medicine', category: 'Pain relief' });
  assert.equal(state.medicines[0].name, 'Updated medicine');
  assert.equal(state.medicines[0].unit, 'Strip');
});

test('own backups restore and inconsistent financial records or excess returns are rejected', () => {
  let { state, medicineId, supplierId, customerId } = fixture();
  state = purchase(state, medicineId, supplierId);
  const batchId = state.batches[0].id;
  state = act(state, 'checkout', { customerId, items: [{ batchId, qty: 3 }], discount: 3, taxRate: 10, paid: 62.7, method: 'Cash' });
  state = act(state, 'saleReturn', { saleId: state.sales[0].id, items: [{ batchId, qty: 3 }], disposition: 'restock', notes: 'Unopened' });
  const restore = backup => act(initialState(), 'restoreBackup', { state: backup, confirmation: 'RESTORE' });
  const restored = restore(state);
  for (const key of ['medicines', 'batches', 'sales', 'purchases', 'customers', 'suppliers', 'payments', 'returns']) assert.deepEqual(restored[key], state[key]);
  for (const mutate of [
    backup => { backup.sales[0].items[0].lineTotal += 0.01; },
    backup => { backup.sales[0].subtotal += 0.01; },
    backup => { backup.sales[0].tax += 0.01; },
    backup => { backup.sales[0].total += 0.01; },
    backup => { backup.returns[0].refund += 0.01; },
    backup => { backup.returns.push({ ...structuredClone(backup.returns[0]), id: 'extra-return' }); },
  ]) {
    const bad = structuredClone(state); mutate(bad);
    assert.throws(() => restore(bad), /backup/i);
  }
  assert.doesNotThrow(() => restore(act(initialState(), 'loadDemo')), 'sample data is also a valid exported backup');
});

test('repeated tiny partial returns cannot accumulate rounding losses or negative final discounts', () => {
  let { state, medicineId } = fixture();
  state = act(state, 'addBatch', { medicineId, batchNo: 'CENTS', expiry: '2027-12-31', qty: 100, cost: 0, price: 0.01 });
  const batchId = state.batches[0].id;
  state = act(state, 'checkout', { items: [{ batchId, qty: 100 }], discount: 0.51, taxRate: 10, paid: 0.54, method: 'Cash' });
  const sale = state.sales[0];
  for (let i = 0; i < 100; i++) {
    state = act(state, 'saleReturn', { saleId: sale.id, items: [{ batchId, qty: 1 }], disposition: 'restock', notes: 'Partial return' });
    const r = state.returns.at(-1);
    assert.ok(r.total >= 0 && r.discount >= 0 && r.tax >= 0);
  }
  const sum = key => Math.round(state.returns.reduce((n, r) => n + r[key], 0) * 100) / 100;
  assert.equal(sum('total'), sale.total); assert.equal(sum('discount'), sale.discount); assert.equal(sum('tax'), sale.tax);
  assert.doesNotThrow(() => act(initialState(), 'restoreBackup', { state, confirmation: 'RESTORE' }));
});
