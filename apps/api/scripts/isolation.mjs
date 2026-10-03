// Checks that a seller sees their own work and their own store, and nothing
// from any other store. It sets up two selling stores (A with two sellers,
// B with one), gives both stock, sales, a request, a deposit and a cash
// report, then reads every endpoint as a seller in store A and looks for any
// trace of store B. It writes data, so run it against a development database
// only.
//
//   API=http://localhost:3001 OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/isolation.mjs
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
  return { status: res.status, body: json, text };
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

async function must(label, promise, status = 201) {
  const res = await promise;
  if (res.status !== status) throw new Error(`${label}: ${res.status} ${res.text}`);
  return res.body;
}

const driver = { driverName: "Abebe Kebede", driverPhone: "0911 000 000", vehiclePlate: "AA-3-12345" };

async function main() {
  const owner = await login(process.env.OWNER_EMAIL, process.env.OWNER_PASSWORD);

  // --- Setup ------------------------------------------------------------------
  const main = (await call(owner, "GET", "/api/branches")).body.branches.find((b) => b.isMainStock);
  const storeA = (await must("store A", call(owner, "POST", "/api/branches", { name: `Alpha ${RUN}` }))).branch;
  const storeB = (await must("store B", call(owner, "POST", "/api/branches", { name: `Bravo ${RUN}` }))).branch;

  const categories = (await call(owner, "GET", "/api/categories")).body.categories;
  const phones = categories.find((c) => c.name === "Phones");
  const accessories = categories.find((c) => c.name === "Accessories");
  const brand = (await must("brand", call(owner, "POST", "/api/product-types", { categoryId: phones.id, name: `Tecno ${RUN}` }))).type;
  const phone = (await must("phone", call(owner, "POST", "/api/products", { typeId: brand.id, price: 9000, storage: "64GB", color: "Blue" }))).product;
  const accBrand = (await must("acc brand", call(owner, "POST", "/api/product-types", { categoryId: accessories.id, name: `Anker ${RUN}` }))).type;
  const cable = (await must("cable", call(owner, "POST", "/api/products", { typeId: accBrand.id, price: 300, model: "USB-C cable" }))).product;

  const user = (name, tag, branchId) =>
    must(name, call(owner, "POST", "/api/users", {
      name, email: `${tag}-${RUN}@antetech.local`, password: "password123", phone: "0911 444 444", branchId,
    })).then((body) => body.user);

  const a1 = await user(`Abel ${RUN}`, "a1", storeA.id);
  const a2 = await user(`Almaz ${RUN}`, "a2", storeA.id);
  const b1 = await user(`Bereket ${RUN}`, "b1", storeB.id);

  const ta1 = await login(`a1-${RUN}@antetech.local`, "password123");
  const ta2 = await login(`a2-${RUN}@antetech.local`, "password123");
  const tb1 = await login(`b1-${RUN}@antetech.local`, "password123");

  await must("stock phones", call(owner, "POST", "/api/inventory/stock-in", { productId: phone.id, locationId: main.id, quantity: 20 }));
  await must("stock cables", call(owner, "POST", "/api/inventory/stock-in", { productId: cable.id, locationId: main.id, quantity: 40 }));

  const toA = (await must("transfer to A", call(owner, "POST", "/api/transfers", {
    fromLocationId: main.id, toLocationId: storeA.id,
    items: [{ productId: phone.id, quantity: 5 }, { productId: cable.id, quantity: 10 }], ...driver,
  }))).transfer;
  const toB = (await must("transfer to B", call(owner, "POST", "/api/transfers", {
    fromLocationId: main.id, toLocationId: storeB.id,
    items: [{ productId: phone.id, quantity: 4 }, { productId: cable.id, quantity: 8 }], ...driver,
  }))).transfer;
  await must("A receives", call(ta1, "PATCH", `/api/transfers/${toA.id}/receive`, {}), 200);
  await must("B receives", call(tb1, "PATCH", `/api/transfers/${toB.id}/receive`, {}), 200);

  const imei = (n) => `86${RUN}${n}${Date.now().toString().slice(-7)}`;
  const saleA1 = (await must("a1 sale", call(ta1, "POST", "/api/sales", {
    items: [{ productId: phone.id, quantity: 1, serials: [imei(1)] }], cashReceived: 9000,
  }))).sale;
  const saleA2 = (await must("a2 sale", call(ta2, "POST", "/api/sales", {
    items: [{ productId: cable.id, quantity: 2 }], cashReceived: 600,
  }))).sale;
  const saleB1 = (await must("b1 sale", call(tb1, "POST", "/api/sales", {
    items: [{ productId: phone.id, quantity: 1, serials: [imei(2)] }], cashReceived: 9000,
  }))).sale;

  const reqA1 = (await must("a1 request", call(ta1, "POST", "/api/requests", { items: [{ productId: cable.id, quantity: 5 }] }))).request;
  const reqB1 = (await must("b1 request", call(tb1, "POST", "/api/requests", { items: [{ productId: phone.id, quantity: 3 }], notes: `Bravo note ${RUN}` }))).request;
  // Approving B's request leaves a delivery in transit to B.
  const approvedB = (await must("approve b1", call(owner, "PATCH", `/api/requests/${reqB1.id}/approve`, { sourceBranchId: main.id, ...driver }), 200)).request;

  const deposit = (token, ref) => {
    const form = new FormData();
    form.set("amount", "9000");
    form.set("receiptDate", new Date().toISOString().slice(0, 10));
    form.set("bankName", "Commercial Bank of Ethiopia");
    form.set("referenceNumber", ref);
    return must(`deposit ${ref}`, call(token, "POST", "/api/receipts", form)).then((body) => body.receipt);
  };
  const receiptA1 = await deposit(ta1, `FTA${RUN}`);
  const receiptB1 = await deposit(tb1, `FTB${RUN}`);
  await must("verify b1 deposit", call(owner, "PATCH", `/api/receipts/${receiptB1.id}/verify`, {}), 200);

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const reportB1 = (await must("b1 cash report", call(tb1, "POST", "/api/cash-reports", {
    periodStart: start.toISOString(), periodEnd: new Date().toISOString(),
  }))).report;
  await must("b1 submits", call(tb1, "PATCH", `/api/cash-reports/${reportB1.id}/submit`, {}), 200);
  const expenseB = (await must("b1 expense", call(tb1, "POST", "/api/expenses", { amount: 120, reason: `Bravo fuel ${RUN}` }))).expense;
  const assetB = (await must("asset B", call(owner, "POST", "/api/assets", { locationId: storeB.id, name: `Bravo printer ${RUN}`, category: "ELECTRONICS" }))).asset;
  const dedB = (await must("b1 deduction", call(tb1, "POST", "/api/deductions", { day: new Date().toISOString().slice(0, 10), lines: [{ productId: cable.id, quantity: 1 }], note: `Bravo short ${RUN}` }))).deduction;

  // --- Everything store A's seller can read ---------------------------------
  // Anything that names store B, its seller or its records is a leak.
  const traces = {
    "store B id": storeB.id,
    "store B name": storeB.name,
    "seller B id": b1.id,
    "seller B name": b1.name,
    "seller B email": `b1-${RUN}@antetech.local`,
    "B's sale": saleB1.id,
    "B's request": reqB1.id,
    "B's request note": `Bravo note ${RUN}`,
    "B's delivery": toB.id,
    "B's restock delivery": approvedB.transfer.id,
    "B's deposit": receiptB1.id,
    "B's deposit ref": `FTB${RUN}`,
    "B's cash report": reportB1.id,
    "B's expense": expenseB.id,
    "B's expense reason": `Bravo fuel ${RUN}`,
    "B's equipment": assetB.id,
    "B's equipment name": `Bravo printer ${RUN}`,
    "B's deduction": dedB.id,
    "B's deduction note": `Bravo short ${RUN}`,
  };

  // Every list and summary, plain and with another store's ids slipped into
  // the query: a seller's scope must ignore them.
  const pry = `branchId=${storeB.id}&locationId=${storeB.id}&salespersonId=${b1.id}`;
  const reads = [
    "/api/auth/me",
    "/api/users/me",
    "/api/branches",
    "/api/products",
    "/api/inventory",
    "/api/inventory/summary",
    "/api/inventory/units",
    "/api/inventory/movements",
    "/api/requests",
    "/api/transfers",
    "/api/sales",
    "/api/cash-reports",
    "/api/receipts",
    "/api/receipts/day-summary",
    "/api/reports/dashboard",
    "/api/reports/sales",
    "/api/reports/cash-position",
    "/api/reports/inventory",
    "/api/notifications",
    "/api/sync/changes",
    "/api/settings",
    "/api/expenses",
    "/api/assets",
    "/api/deductions",
  ];

  for (const path of reads) {
    for (const url of [path, `${path}?${pry}`]) {
      const res = await call(ta1, "GET", url);
      if (res.status === 403) {
        check(`A seller: ${url} is closed to sellers`, true);
        continue;
      }
      const leaked = Object.entries(traces).filter(([, value]) => res.text.includes(value));
      check(
        `A seller: ${url} shows nothing of store B`,
        res.status === 200 && leaked.length === 0,
        `${res.status} ${leaked.map(([what]) => what).join(", ") || res.text.slice(0, 200)}`,
      );
    }
  }

  // Asking for store B's records by id: reported as not there.
  const direct = [
    [`/api/sales/${saleB1.id}`, "B's sale"],
    [`/api/requests/${reqB1.id}`, "B's request"],
    [`/api/transfers/${toB.id}`, "B's delivery"],
    [`/api/transfers/${approvedB.transfer.id}`, "B's restock delivery"],
    [`/api/receipts/${receiptB1.id}`, "B's deposit"],
    [`/api/cash-reports/${reportB1.id}`, "B's cash report"],
    [`/api/branches/${storeB.id}`, "store B"],
    [`/api/inventory/location/${storeB.id}`, "store B's stock"],
    [`/api/users/${b1.id}`, "seller B"],
    ["/api/users", "the staff list"],
    ["/api/users/by-branch", "stores with their sellers"],
    ["/api/settings/backup", "the backup"],
    ["/api/payroll/month", "the payroll"],
    ["/api/payroll/employees", "the payroll staff"],
    ["/api/payroll/commissions", "commission payments"],
    ["/api/payroll/sold", "sales counts for commission"],
  ];

  for (const [url, what] of direct) {
    const res = await call(ta1, "GET", url);
    const leaked = Object.values(traces).some((value) => res.text.includes(value));
    // A list endpoint may answer with an empty list instead.
    const empty = res.status === 200 && Object.values(res.body ?? {}).every((v) => Array.isArray(v) && v.length === 0);
    check(`A seller cannot open ${what}`, ([403, 404].includes(res.status) || empty) && !leaked, `${res.status} ${res.text.slice(0, 200)}`);
  }

  // --- What store A's seller should see ---------------------------------------
  const mySales = (await call(ta1, "GET", "/api/sales")).body.sales ?? [];
  check("A seller sees their own sale", mySales.some((s) => s.id === saleA1.id));
  check("A seller does not see a co-worker's sale", !mySales.some((s) => s.id === saleA2.id));

  const myRequests = (await call(ta1, "GET", "/api/requests")).body.requests ?? [];
  check("A seller sees their own request", myRequests.some((r) => r.id === reqA1.id));

  const myReceipts = (await call(ta1, "GET", "/api/receipts")).body.receipts ?? [];
  check("A seller sees their own deposit", myReceipts.some((r) => r.id === receiptA1.id));

  const myTransfers = (await call(ta1, "GET", "/api/transfers")).body.transfers ?? [];
  check("A seller sees deliveries to their store", myTransfers.some((t) => t.id === toA.id));

  const myStock = (await call(ta1, "GET", "/api/inventory")).body.inventory ?? [];
  check(
    "A seller sees their store's stock",
    myStock.some((row) => row.productId === cable.id && row.quantity === 8) &&
      myStock.every((row) => (row.locationId ?? row.location?.id) === storeA.id),
    JSON.stringify(myStock).slice(0, 300),
  );

  const products = (await call(ta1, "GET", "/api/products")).body.products ?? [];
  const phoneRow = products.find((p) => p.id === phone.id);
  check(
    "the catalogue shows a seller only their own store's counts",
    phoneRow?.inventoryBalances.every((balance) => balance.locationId === storeA.id),
    JSON.stringify(phoneRow?.inventoryBalances),
  );

  const dash = (await call(ta1, "GET", "/api/reports/dashboard")).body.dashboard;
  const feed = JSON.stringify(dash ?? {});
  check("A seller's dashboard shows their store's delivery", feed.includes(storeA.name), feed.slice(0, 200));

  // --- And the other way round ---------------------------------------------------
  const bView = await Promise.all(reads.map((path) => call(tb1, "GET", path)));
  const aTraces = [storeA.id, storeA.name, a1.id, a1.name, a2.id, a2.name, saleA1.id, saleA2.id, reqA1.id, toA.id, receiptA1.id];
  const backLeaks = bView.flatMap((res, i) =>
    res.status === 200 && aTraces.some((value) => res.text.includes(value)) ? [reads[i]] : [],
  );
  check("B seller sees nothing of store A anywhere", backLeaks.length === 0, backLeaks.join(", "));

  // The Owner still sees both.
  const ownerSales = (await call(owner, "GET", "/api/sales")).body.sales ?? [];
  check("the Owner sees every store's sales", [saleA1.id, saleA2.id, saleB1.id].every((id) => ownerSales.some((s) => s.id === id)));

  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
  process.exit(failures);
}

main().catch((error) => {
  console.error(error);
  process.exit(99);
});
