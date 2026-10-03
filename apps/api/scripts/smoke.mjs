// End-to-end check of the AnteTech flow against a running API and a freshly
// seeded database. It creates stores, sellers, products and stock, so run it
// against a development database only.
//
//   API=http://localhost:3001 OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/smoke.mjs
//
// Each step prints PASS or FAIL; the exit code is the number of failures.

const API = process.env.API ?? "http://localhost:3001";
const RUN = Date.now().toString(36).slice(-5);

let failures = 0;

function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${detail}`}`);
}

async function call(token, method, path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function login(email, password) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.token) throw new Error(`login failed for ${email}: ${JSON.stringify(json)}`);
  return json.token;
}

async function stockAt(token, locationId, productId) {
  const { body } = await call(token, "GET", `/api/inventory?locationId=${locationId}`);
  const row = (body.inventory ?? []).find((entry) => entry.productId === productId);
  return row?.quantity ?? 0;
}

const driver = { driverName: "Abebe Kebede", driverPhone: "0911 000 000", vehiclePlate: "AA-3-12345" };

async function main() {
  const owner = await login(process.env.OWNER_EMAIL, process.env.OWNER_PASSWORD);

  // --- Stores ---------------------------------------------------------------
  const branches = (await call(owner, "GET", "/api/branches")).body.branches;
  const main = branches.find((b) => b.isMainStock);
  check("seeded main store exists", Boolean(main));

  const storeA = (await call(owner, "POST", "/api/branches", { name: `Store A ${RUN}` })).body.branch;
  const storeB = (await call(owner, "POST", "/api/branches", { name: `Store B ${RUN}` })).body.branch;
  check("owner adds selling stores", storeA?.isMainStock === false && storeB?.isMainStock === false);

  const closeMain = await call(owner, "PATCH", `/api/branches/${main.id}/status`, { isActive: false });
  check("main store cannot be closed", closeMain.status === 409, JSON.stringify(closeMain.body));

  const deleteMain = await call(owner, "DELETE", `/api/branches/${main.id}`);
  check("main store cannot be deleted", deleteMain.status === 409, JSON.stringify(deleteMain.body));

  // --- Catalogue ------------------------------------------------------------
  const categories = (await call(owner, "GET", "/api/categories")).body.categories;
  const phones = categories.find((c) => c.name === "Phones");
  const accessories = categories.find((c) => c.name === "Accessories");
  check("seeded categories have their kinds", phones?.kind === "SERIALIZED" && accessories?.kind === "QUANTITY");

  const laptops = await call(owner, "POST", "/api/categories", { name: `Laptops ${RUN}`, kind: "SERIALIZED" });
  check("owner adds a category with a kind", laptops.status === 201 && laptops.body.category.kind === "SERIALIZED");

  const brand = (await call(owner, "POST", "/api/product-types", { categoryId: phones.id, name: `Samsung ${RUN}` })).body.type;
  const model = (await call(owner, "POST", "/api/product-types", { categoryId: phones.id, name: "Galaxy A15", parentId: brand.id })).body.type;
  const phoneRes = await call(owner, "POST", "/api/products", { typeId: model.id, price: 15000, storage: "128GB", color: "Black" });
  const phone = phoneRes.body.product;
  check("phone product created with a PHO code", phoneRes.status === 201 && phone.sku.startsWith("PHO-") && phone.category === "SERIALIZED", JSON.stringify(phoneRes.body));

  const accBrand = (await call(owner, "POST", "/api/product-types", { categoryId: accessories.id, name: `Oraimo ${RUN}` })).body.type;
  const chargerRes = await call(owner, "POST", "/api/products", { typeId: accBrand.id, price: 500, model: "20W charger" });
  const charger = chargerRes.body.product;
  check("accessory product created", chargerRes.status === 201 && charger.category === "QUANTITY", JSON.stringify(chargerRes.body));

  // --- Sellers --------------------------------------------------------------
  const sellerInMain = await call(owner, "POST", "/api/users", {
    name: "Nobody", email: `main-${RUN}@antetech.local`, password: "password123", phone: "0911 111 111", branchId: main.id,
  });
  check("a seller cannot be placed in the main store", sellerInMain.status === 400, JSON.stringify(sellerInMain.body));

  const sellerA = (await call(owner, "POST", "/api/users", {
    name: "Seller A", email: `a-${RUN}@antetech.local`, password: "password123", phone: "0911 222 222", branchId: storeA.id,
  })).body.user;
  const sellerB = (await call(owner, "POST", "/api/users", {
    name: "Seller B", email: `b-${RUN}@antetech.local`, password: "password123", phone: "0911 333 333", branchId: storeB.id,
  })).body.user;
  check("owner adds sellers as SALES", sellerA?.role === "SALES" && sellerB?.role === "SALES");

  const moveToMain = await call(owner, "PATCH", `/api/users/${sellerA.id}/branch`, { branchId: main.id });
  check("a seller cannot be moved into the main store", moveToMain.status === 400, JSON.stringify(moveToMain.body));

  const a = await login(`a-${RUN}@antetech.local`, "password123");
  const b = await login(`b-${RUN}@antetech.local`, "password123");

  // --- Stock-in: main store only ---------------------------------------------
  const intoSelling = await call(owner, "POST", "/api/inventory/stock-in", { productId: phone.id, locationId: storeA.id, quantity: 5 });
  check("stock-in to a selling store is refused", intoSelling.status === 400, JSON.stringify(intoSelling.body));

  await call(owner, "POST", "/api/inventory/stock-in", { productId: phone.id, locationId: main.id, quantity: 20 });
  await call(owner, "POST", "/api/inventory/stock-in", { productId: charger.id, locationId: main.id, quantity: 30 });
  check("stock-in to the main store", (await stockAt(owner, main.id, phone.id)) === 20);

  const sellerStockIn = await call(a, "POST", "/api/inventory/stock-in", { productId: phone.id, locationId: main.id, quantity: 1 });
  check("a seller cannot stock in", sellerStockIn.status === 403);

  // --- Transfer main -> A, received by the seller ----------------------------
  const t1 = await call(owner, "POST", "/api/transfers", {
    fromLocationId: main.id, toLocationId: storeA.id,
    items: [{ productId: phone.id, quantity: 10 }, { productId: charger.id, quantity: 10 }],
    ...driver,
  });
  check("owner sends a transfer", t1.status === 201 && t1.body.transfer.status === "IN_TRANSIT", JSON.stringify(t1.body));
  check("goods leave the main store at once", (await stockAt(owner, main.id, phone.id)) === 10);
  check("goods are not in store A until received", (await stockAt(owner, storeA.id, phone.id)) === 0);

  const sellerTransfer = await call(a, "POST", "/api/transfers", {
    fromLocationId: main.id, toLocationId: storeA.id, items: [{ productId: phone.id, quantity: 1 }], ...driver,
  });
  check("a seller cannot send transfers", sellerTransfer.status === 403);

  const wrongReceiver = await call(b, "PATCH", `/api/transfers/${t1.body.transfer.id}/receive`, {});
  check("another store's seller cannot receive it", wrongReceiver.status >= 400, JSON.stringify(wrongReceiver.body));

  const r1 = await call(a, "PATCH", `/api/transfers/${t1.body.transfer.id}/receive`, {});
  check("store A's seller receives it", r1.status === 200, JSON.stringify(r1.body));
  check("store A now holds 10 phones", (await stockAt(owner, storeA.id, phone.id)) === 10);

  // --- Sales -----------------------------------------------------------------
  const imei = `35${RUN}${Date.now().toString().slice(-8)}`;
  const s1 = await call(a, "POST", "/api/sales", {
    items: [{ productId: phone.id, quantity: 1, serials: [imei] }], cashReceived: 15000, paymentMethod: "CASH",
  });
  check("seller sells a phone with its IMEI", s1.status === 201, JSON.stringify(s1.body));
  check("store A drops to 9 phones", (await stockAt(owner, storeA.id, phone.id)) === 9);

  const again = await call(a, "POST", "/api/sales", {
    items: [{ productId: phone.id, quantity: 1, serials: [imei] }], cashReceived: 15000,
  });
  check("the same IMEI cannot be sold twice", again.status === 409, JSON.stringify(again.body));

  const noImei = await call(a, "POST", "/api/sales", { items: [{ productId: phone.id, quantity: 1 }], cashReceived: 15000 });
  check("a phone sale needs its IMEI", noImei.status === 400, JSON.stringify(noImei.body));

  const accSerial = await call(a, "POST", "/api/sales", {
    items: [{ productId: charger.id, quantity: 1, serials: ["X123"] }], cashReceived: 500,
  });
  check("an accessory sale sends no serials", accSerial.status === 400, JSON.stringify(accSerial.body));

  const oversell = await call(a, "POST", "/api/sales", { items: [{ productId: charger.id, quantity: 11 }], cashReceived: 5500 });
  check("cannot sell more than the store holds", oversell.status === 409, JSON.stringify(oversell.body));

  const banks = (await call(a, "GET", "/api/banks")).body.banks ?? [];
  check(
    "the bank list is there for transfer sales",
    banks.length >= 30 && banks[0].name === "Commercial Bank of Ethiopia (CBE)" && banks.some((bank) => bank.name === "Telebirr"),
    `${banks.length} banks`,
  );
  const sameBank = await call(a, "POST", "/api/banks", { name: "dashen  BANK" });
  check("a bank already listed is not added twice", sameBank.body.bank?.name === "Dashen Bank" && (await call(a, "GET", "/api/banks")).body.banks.length === banks.length);

  const transferSale = await call(a, "POST", "/api/sales", {
    items: [{ productId: charger.id, quantity: 2 }], cashReceived: 1000, paymentMethod: "TRANSFER", bankName: "Commercial Bank of Ethiopia",
  });
  check("a bank-transfer sale", transferSale.status === 201, JSON.stringify(transferSale.body));
  check("store A drops to 8 chargers", (await stockAt(owner, storeA.id, charger.id)) === 8);

  const ownerSale = await call(owner, "POST", "/api/sales", { items: [{ productId: charger.id, quantity: 1 }], cashReceived: 500 });
  check("the Owner does not sell", ownerSale.status === 403);

  // --- Restock request -> approved -> received --------------------------------
  const req = await call(a, "POST", "/api/requests", { items: [{ productId: phone.id, quantity: 5 }], notes: "Running low" });
  check("seller raises a restock request to the Owner", req.status === 201 && req.body.request.requestedTo.role === "OWNER", JSON.stringify(req.body));

  const ownerRequest = await call(owner, "POST", "/api/requests", { items: [{ productId: phone.id, quantity: 1 }] });
  check("the Owner does not raise requests", ownerRequest.status === 403);

  const sellerApprove = await call(a, "PATCH", `/api/requests/${req.body.request.id}/approve`, { sourceBranchId: main.id, ...driver });
  check("a seller cannot approve", sellerApprove.status === 403);

  const notes = await call(owner, "GET", "/api/notifications");
  check(
    "the Owner is notified of the request",
    (notes.body.notifications ?? []).some((n) => n.kind === "REQUESTS_TO_DECIDE"),
    JSON.stringify(notes.body),
  );

  const approve = await call(owner, "PATCH", `/api/requests/${req.body.request.id}/approve`, { sourceBranchId: main.id, ...driver });
  check("owner approves from the main store", approve.status === 200 && approve.body.request.transfer?.status === "IN_TRANSIT", JSON.stringify(approve.body));
  check("main store drops to 5 phones", (await stockAt(owner, main.id, phone.id)) === 5);

  const sellerNotes = await call(a, "GET", "/api/notifications");
  check(
    "the seller is told goods are on the way",
    (sellerNotes.body.notifications ?? []).some((n) => n.kind === "DELIVERIES_TO_RECEIVE"),
    JSON.stringify(sellerNotes.body),
  );

  await call(a, "PATCH", `/api/transfers/${approve.body.request.transfer.id}/receive`, {});
  check("store A now holds 14 phones", (await stockAt(owner, storeA.id, phone.id)) === 14);
  const fulfilled = await call(a, "GET", `/api/requests/${req.body.request.id}`);
  check("the request reads fulfilled", fulfilled.body.request?.status === "FULFILLED", JSON.stringify(fulfilled.body));

  // --- A mixed request, decided one category at a time ------------------------
  const mixed = (await call(a, "POST", "/api/requests", {
    items: [{ productId: phone.id, quantity: 2 }, { productId: charger.id, quantity: 4 }],
  })).body.request;
  const phoneLine = mixed.items.find((item) => item.product.id === phone.id);
  const chargerLine = mixed.items.find((item) => item.product.id === charger.id);
  check("each line carries its category", phoneLine.product.productCategory?.name === "Phones" && chargerLine.product.productCategory?.name === "Accessories");

  const okPhones = await call(owner, "PATCH", `/api/requests/${mixed.id}/items/decide`, { itemIds: [phoneLine.id], approve: true });
  check("owner approves the phones on their own", okPhones.status === 200 && okPhones.body.request.status === "PENDING", JSON.stringify(okPhones.body));
  const noChargers = await call(owner, "PATCH", `/api/requests/${mixed.id}/items/decide`, { itemIds: [chargerLine.id], approve: false });
  check("owner rejects the accessories on their own", noChargers.status === 200, JSON.stringify(noChargers.body));

  const sendMixed = await call(owner, "PATCH", `/api/requests/${mixed.id}/approve`, { sourceBranchId: main.id, ...driver });
  const shipped = sendMixed.body.request?.transfer?.id
    ? (await call(owner, "GET", `/api/transfers/${sendMixed.body.request.transfer.id}`)).body.transfer
    : null;
  check(
    "only the approved category ships",
    sendMixed.status === 200 && shipped?.items.length === 1 && shipped.items[0].product.id === phone.id && shipped.items[0].quantity === 2,
    JSON.stringify(sendMixed.body).slice(0, 300),
  );
  await call(a, "PATCH", `/api/transfers/${shipped.id}/receive`, {});
  check("store A now holds 16 phones", (await stockAt(owner, storeA.id, phone.id)) === 16);

  // --- Store to store ----------------------------------------------------------
  const t2 = await call(owner, "POST", "/api/transfers", {
    fromLocationId: storeA.id, toLocationId: storeB.id, items: [{ productId: charger.id, quantity: 3 }], ...driver,
  });
  check("owner moves stock between selling stores", t2.status === 201, JSON.stringify(t2.body));
  await call(b, "PATCH", `/api/transfers/${t2.body.transfer.id}/receive`, {});
  check("store B holds 3 chargers", (await stockAt(owner, storeB.id, charger.id)) === 3);

  // --- Cash report and a deposit without a slip ------------------------------
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const report = await call(a, "POST", "/api/cash-reports", { periodStart: start.toISOString(), periodEnd: new Date().toISOString() });
  check("seller reconciles the day", report.status === 201, JSON.stringify(report.body));
  const submitted = await call(a, "PATCH", `/api/cash-reports/${report.body.report.id}/submit`, {});
  check("seller submits the cash report", submitted.status === 200, JSON.stringify(submitted.body));
  const approved = await call(owner, "PATCH", `/api/cash-reports/${report.body.report.id}/approve`, {});
  check("owner approves the cash report", approved.status === 200 && approved.body.report.status === "APPROVED", JSON.stringify(approved.body));

  // Yadere is cash only: the 1,000 the customer transferred is already in the
  // bank, so store A holds just the 15,000 phone sale in cash.
  const today = new Date().toISOString().slice(0, 10);
  const day = (await call(a, "GET", `/api/receipts/day-summary?date=${today}`)).body.summary;
  check("yadere counts cash sales only", Number(day?.daySales) === 15000 && Number(day?.yadere) === 15000, JSON.stringify(day));

  const form = new FormData();
  form.set("amount", "15000");
  form.set("receiptDate", today);
  form.set("bankName", "Commercial Bank of Ethiopia");
  form.set("referenceNumber", `FT${RUN}`);
  const receipt = await call(a, "POST", "/api/receipts", form);
  check("seller records a deposit with no slip", receipt.status === 201 && receipt.body.receipt.fileUrl == null, JSON.stringify(receipt.body));
  check("banking the cash leaves no yadere", Number(receipt.body.receipt?.yadere) === 0, JSON.stringify(receipt.body.receipt));
  const sellerVerify = await call(a, "PATCH", `/api/receipts/${receipt.body.receipt.id}/verify`, {});
  check("a seller cannot verify deposits", sellerVerify.status === 403);
  const verified = await call(owner, "PATCH", `/api/receipts/${receipt.body.receipt.id}/verify`, {});
  check("owner verifies the deposit", verified.status === 200, JSON.stringify(verified.body));

  // --- Expenses ----------------------------------------------------------------------
  // `today` ("YYYY-MM-DD") is already declared by the cash-report section above.
  const expA = await call(a, "POST", "/api/expenses", { amount: 250, reason: "Transport", date: today });
  check("a seller records their store's expense", expA.status === 201 && expA.body.expense.locationId === storeA.id, JSON.stringify(expA.body));
  const expMain = await call(owner, "POST", "/api/expenses", { amount: 900, reason: "Rent", branchId: main.id });
  check("the Owner records an expense for the main store", expMain.status === 201 && expMain.body.expense.locationId === main.id, JSON.stringify(expMain.body));
  const expNoStore = await call(owner, "POST", "/api/expenses", { amount: 10, reason: "Water" });
  check("the Owner must choose a store", expNoStore.status === 400);
  const expBadAmount = await call(a, "POST", "/api/expenses", { amount: -5, reason: "Water" });
  check("an expense needs a positive amount", expBadAmount.status === 400);
  const ownerExpenses = await call(owner, "GET", `/api/expenses?from=${today}&to=${today}`);
  check("the Owner sees every store's expenses", ownerExpenses.body.total >= 1150 && ownerExpenses.body.byBranch.length >= 2, JSON.stringify(ownerExpenses.body).slice(0, 200));
  const bExpenses = await call(b, "GET", `/api/expenses?from=${today}&to=${today}&branchId=${storeA.id}`);
  check("store B's seller sees none of store A's expenses", (bExpenses.body.expenses ?? []).length === 0, JSON.stringify(bExpenses.body).slice(0, 200));
  const bDeletesA = await call(b, "DELETE", `/api/expenses/${expA.body.expense.id}`);
  check("a seller cannot delete another seller's expense", bDeletesA.status === 403 || bDeletesA.status === 404);
  const expNotes = await call(owner, "GET", "/api/notifications");
  const expNotice = (expNotes.body.notifications ?? []).find((n) => n.kind === "EXPENSES_ADDED");
  check("the Owner is told about the seller's expense, not their own", expNotice && !(expNotice.sample ?? []).some((line) => line.includes("Rent")), JSON.stringify(expNotice));

  // --- Office equipment -------------------------------------------------------------
  const laptop = await call(owner, "POST", "/api/assets", { locationId: storeA.id, name: "Dell laptop", category: "ELECTRONICS", serialNumber: `SN${RUN}`, cost: 42000 });
  check("the Owner adds equipment to a store", laptop.status === 201 && laptop.body.asset.status === "IN_USE", JSON.stringify(laptop.body));
  const sellerAdds = await call(a, "POST", "/api/assets", { locationId: storeA.id, name: "Chair", category: "FURNITURE" });
  check("a seller cannot add equipment", sellerAdds.status === 403);
  const sellerRenames = await call(a, "PATCH", `/api/assets/${laptop.body.asset.id}`, { name: "Mine now", cost: 1 });
  check("a seller cannot change equipment details", sellerRenames.status === 403, JSON.stringify(sellerRenames.body));
  const sellerDamages = await call(a, "PATCH", `/api/assets/${laptop.body.asset.id}`, { status: "DAMAGED" });
  check("a seller marks their store's equipment damaged", sellerDamages.status === 200 && sellerDamages.body.asset.status === "DAMAGED", JSON.stringify(sellerDamages.body));
  const otherStoreDamages = await call(b, "PATCH", `/api/assets/${laptop.body.asset.id}`, { status: "RETIRED" });
  check("another store's seller cannot touch it", otherStoreDamages.status === 404);
  const sellerRetires = await call(a, "PATCH", `/api/assets/${laptop.body.asset.id}`, { status: "RETIRED" });
  check("a seller retires their store's equipment", sellerRetires.status === 200 && sellerRetires.body.asset.status === "RETIRED");
  const ownerEdits = await call(owner, "PATCH", `/api/assets/${laptop.body.asset.id}`, { name: "Dell laptop 15", cost: null });
  check("the Owner edits equipment and can clear a cost typed by mistake", ownerEdits.status === 200 && ownerEdits.body.asset.name === "Dell laptop 15" && ownerEdits.body.asset.cost === null, JSON.stringify(ownerEdits.body).slice(0, 200));
  const sellerDeletes = await call(a, "DELETE", `/api/assets/${laptop.body.asset.id}`);
  check("a seller cannot remove equipment", sellerDeletes.status === 403);

  // --- Deductions ------------------------------------------------------------------
  const thisMonth = today.slice(0, 7);
  const dedA = await call(a, "POST", "/api/deductions", { day: today, lines: [{ productId: charger.id, quantity: 2 }], note: "Two chargers short" });
  check("a seller records their own deduction at the selling price", dedA.status === 201 && Number(dedA.body.deduction.total) === 1000 && dedA.body.deduction.userId === sellerA.id, JSON.stringify(dedA.body));
  const dedForB = await call(owner, "POST", "/api/deductions", { day: today, userId: sellerB.id, lines: [{ productId: charger.id, quantity: 1 }] });
  check("the Owner records a deduction for any seller", dedForB.status === 201 && dedForB.body.deduction.userId === sellerB.id);
  const dedForOwner = await call(owner, "POST", "/api/deductions", { day: today, lines: [{ productId: charger.id, quantity: 1 }] });
  check("the Owner must name the seller", dedForOwner.status === 400);
  const aSeesDed = await call(a, "GET", `/api/deductions?month=${thisMonth}&userId=${sellerB.id}`);
  check("a seller sees only their own deductions", (aSeesDed.body.deductions ?? []).every((d) => d.userId === sellerA.id) && aSeesDed.body.deductions.length >= 1);
  const aDeletesB = await call(a, "DELETE", `/api/deductions/${dedForB.body.deduction.id}`);
  check("a seller cannot delete someone else's deduction", aDeletesB.status === 404);

  // --- Salaries ---------------------------------------------------------------------
  const sellerPayroll = await call(a, "GET", `/api/payroll/month?month=${thisMonth}`);
  check("a seller cannot open Salaries", sellerPayroll.status === 403);
  const setSalary = await call(owner, "PATCH", `/api/payroll/employees/${sellerA.id}`, { monthlySalary: 600 });
  check("the Owner sets a seller's monthly salary", setSalary.status === 200, JSON.stringify(setSalary.body));
  const employees = (await call(owner, "GET", "/api/payroll/employees")).body.employees ?? [];
  check("only sellers are on the payroll", employees.length > 0 && employees.every((e) => e.role === "SALES"));
  const monthRow = (await call(owner, "GET", `/api/payroll/month?month=${thisMonth}`)).body.rows?.find((r) => r.employee.id === sellerA.id);
  check("the month's deductions fill the deduction", monthRow?.salary === 600 && monthRow?.deducted === 1000 && monthRow?.payment === null, JSON.stringify(monthRow));
  const paid = await call(owner, "POST", "/api/payroll/payments", { userId: sellerA.id, month: thisMonth, bonus: 100, deduction: monthRow.deducted });
  check(
    "pay never goes below 0 and the rest carries over",
    paid.status === 201 && Number(paid.body.payment.net) === 0 && Number(paid.body.payment.carriedOver) === 300,
    JSON.stringify(paid.body),
  );
  const paidTwice = await call(owner, "POST", "/api/payroll/payments", { userId: sellerA.id, month: thisMonth, bonus: 0, deduction: 0 });
  check("a month is paid once", paidTwice.status === 409);
  const [ny, nm] = thisMonth.split("-").map(Number);
  const nextMonth = `${nm === 12 ? ny + 1 : ny}-${String(nm === 12 ? 1 : nm + 1).padStart(2, "0")}`;
  const nextRow = (await call(owner, "GET", `/api/payroll/month?month=${nextMonth}`)).body.rows?.find((r) => r.employee.id === sellerA.id);
  check("next month's deduction starts with what was carried over", nextRow?.carriedIn === 300 && nextRow?.deducted === 300, JSON.stringify(nextRow));
  const lateDelete = await call(a, "DELETE", `/api/deductions/${dedA.body.deduction.id}`);
  check("a seller cannot delete a deduction once that month is paid", lateDelete.status === 409);
  const edited = await call(owner, "PATCH", `/api/payroll/payments/${paid.body.payment.id}`, { salary: 600, bonus: 500, deduction: 1000 });
  check("editing a payment works out net again", edited.status === 200 && Number(edited.body.payment.net) === 100 && Number(edited.body.payment.carriedOver) === 0, JSON.stringify(edited.body));

  // --- Commission ----------------------------------------------------------------------
  const sellerCommission = await call(a, "GET", `/api/payroll/commissions?month=${thisMonth}`);
  check("a seller cannot open Commission", sellerCommission.status === 403);
  const soldToday = (await call(owner, "GET", `/api/payroll/sold?from=${today}&to=${today}&userIds=${sellerA.id}`)).body.sold?.[sellerA.id] ?? {};
  check("commission counts each seller's own sales", soldToday[phones.id]?.quantity >= 1 && soldToday[accessories.id]?.quantity >= 2, JSON.stringify(soldToday));
  const com = await call(owner, "POST", "/api/payroll/commissions", {
    userIds: [sellerA.id, sellerB.id], month: thisMonth, from: today, to: today,
    lines: [{ item: phones.id, rate: 200 }, { item: accessories.id, rate: 10, percent: true }],
  });
  const comA = (com.body.commissions ?? []).find((row) => row.userId === sellerA.id);
  check(
    "commission is priced from the sales: per phone and a percent of accessories",
    com.status === 201 && Number(comA?.total) === soldToday[phones.id].quantity * 200 + Math.round(soldToday[accessories.id].sales * 10) / 100,
    JSON.stringify(com.body).slice(0, 300),
  );
  check("a seller who sold none of the items is skipped and named", (com.body.skipped ?? []).includes("Seller B"), JSON.stringify(com.body.skipped));
  const comAgain = await call(owner, "POST", "/api/payroll/commissions", { userIds: [sellerA.id], month: thisMonth, from: today, to: today, lines: [{ item: phones.id, rate: 50 }] });
  check("the same days cannot be paid twice", comAgain.status === 409, JSON.stringify(comAgain.body));
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const widen = await call(owner, "POST", "/api/payroll/commissions", { userIds: [sellerA.id], month: thisMonth, from: yesterday, to: today, lines: [{ item: phones.id, rate: 50 }] });
  check("a range that overlaps paid days is refused", widen.status === 409);
  const payrollAfter = (await call(owner, "GET", `/api/payroll/month?month=${thisMonth}`)).body.rows?.find((r) => r.employee.id === sellerA.id);
  check("Salaries shows the commission paid but net pay is unchanged", payrollAfter?.commission === Number(comA?.total) && payrollAfter?.payment?.net === 100, JSON.stringify(payrollAfter));
  const removed = await call(owner, "DELETE", `/api/payroll/commissions/${comA.id}`);
  check("a commission payment can be deleted", removed.status === 200);
  const twoPhoneLines = await call(owner, "POST", "/api/payroll/commissions", {
    userIds: [sellerA.id], month: thisMonth, from: today, to: today,
    lines: [{ item: phones.id, rate: 200 }, { item: phones.id, rate: 200 }],
  });
  check("one payment cannot list the same category twice", twoPhoneLines.status === 400, JSON.stringify(twoPhoneLines.body).slice(0, 200));

  // --- Deleting what has the new records ----------------------------------------------
  const quietStore = (await call(owner, "POST", "/api/branches", { name: `Quiet ${RUN}` })).body.branch;
  await call(owner, "POST", "/api/assets", { locationId: quietStore.id, name: "Desk", category: "FURNITURE" });
  const dropStore = await call(owner, "DELETE", `/api/branches/${quietStore.id}`);
  check("a store with only equipment is kept, not crashed on", dropStore.status === 409, `${dropStore.status} ${JSON.stringify(dropStore.body).slice(0, 120)}`);
  const leaver = (await call(owner, "POST", "/api/users", {
    name: `Leaver ${RUN}`, email: `leaver-${RUN}@antetech.local`, password: "password123", phone: "0911 555 555", branchId: storeA.id,
  })).body.user;
  await call(owner, "POST", "/api/deductions", { day: today, userId: leaver.id, lines: [{ productId: charger.id, quantity: 1 }] });
  const dropLeaver = await call(owner, "DELETE", `/api/users/${leaver.id}`);
  check("a seller with only a deduction is kept, not crashed on", dropLeaver.status === 409, `${dropLeaver.status} ${JSON.stringify(dropLeaver.body).slice(0, 120)}`);

  // --- A seller who has left still gets their last salary ---------------------------
  await call(owner, "PATCH", `/api/payroll/employees/${leaver.id}`, { monthlySalary: 2000 });
  await call(owner, "PATCH", `/api/users/${leaver.id}/status`, { isActive: false });
  const leaverRow = (await call(owner, "GET", `/api/payroll/month?month=${thisMonth}`)).body.rows?.find((r) => r.employee.id === leaver.id);
  check("a deactivated seller with money due this month is still listed", leaverRow?.salary === 2000 && leaverRow?.deducted === 500, JSON.stringify(leaverRow));
  const finalPay = await call(owner, "POST", "/api/payroll/payments", { userId: leaver.id, month: thisMonth, bonus: 0, deduction: 500 });
  check("the Owner pays a deactivated seller's final month", finalPay.status === 201 && Number(finalPay.body.payment?.net) === 1500, JSON.stringify(finalPay.body));

  // --- Reads are scoped ---------------------------------------------------------
  const sellerUsers = await call(a, "GET", "/api/users");
  check("sellers cannot list staff", sellerUsers.status === 403);
  const bSales = await call(b, "GET", "/api/sales");
  check("store B's seller sees none of store A's sales", (bSales.body.sales ?? []).length === 0);
  const dash = await call(owner, "GET", "/api/reports/dashboard");
  check("owner dashboard loads", dash.status === 200 && dash.body.dashboard?.tiles?.devices != null, JSON.stringify(dash.body).slice(0, 300));
  const sellerDash = await call(a, "GET", "/api/reports/dashboard");
  check("seller dashboard loads", sellerDash.status === 200, JSON.stringify(sellerDash.body).slice(0, 300));

  // --- Backup carries the new tables ------------------------------------------------
  const backup = await call(owner, "GET", "/api/settings/backup");
  const backupText = JSON.stringify(backup.body ?? {});
  check(
    "backup includes payroll, deductions, expenses and equipment",
    ["officeAsset", "expense", "deduction", "deductionLine", "payrollPayment", "commissionPayment", "commissionLine"]
      .every((table) => backupText.includes(`"${table}"`)),
    backupText.slice(0, 200),
  );

  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
  process.exit(failures);
}

main().catch((error) => {
  console.error(error);
  process.exit(99);
});
