const STORE_KEY = "vanita-stock-v1";

const seedData = {
  products: [
    { id: "p1", name: "Hydra Medic Serum 60ml", sku: "RPHMS", barcode: "", category: "Skincare", stock: 1, reorderAt: 2, target: 5, unitCost: 25.20, salePrice: 41.63, supplier: "Makiba Essence", icon: "✦", tint: "#e9f4ef" },
    { id: "p2", name: "One Minute Exfoliating Mask 70ml", sku: "RPEM", barcode: "", category: "Skincare", stock: 1, reorderAt: 2, target: 5, unitCost: 25.02, salePrice: 41.36, supplier: "Makiba Essence", icon: "◌", tint: "#f6ece8" },
    { id: "p3", name: "Opti-Firm Eye Contour Cream 15ml", sku: "RPOFEC", barcode: "", category: "Skincare", stock: 1, reorderAt: 2, target: 5, unitCost: 33.99, salePrice: 56.14, supplier: "Makiba Essence", icon: "◉", tint: "#eef0f8" },
    { id: "p4", name: "Botanical SPF50 Tinted Face Lotion 88ml", sku: "AGB50T", barcode: "", category: "Sun care", stock: 1, reorderAt: 2, target: 6, unitCost: 21.86, salePrice: 38.70, supplier: "Makiba Essence", icon: "☀", tint: "#fff2da" },
    { id: "p5", name: "Instant Sunless AG Mousse 177ml", sku: "AGSLM", barcode: "", category: "Sun care", stock: 1, reorderAt: 2, target: 6, unitCost: 16.32, salePrice: 28.90, supplier: "Makiba Essence", icon: "☀", tint: "#f8eee0" },
    { id: "p6", name: "Sandy Beaches 250ml", sku: "AGSB", barcode: "", category: "Body care", stock: 1, reorderAt: 2, target: 5, unitCost: 25.36, salePrice: 44.90, supplier: "Makiba Essence", icon: "≈", tint: "#e7f2f3" },
    { id: "p7", name: "Cancella Età Eye Corrector 00", sku: "MYFCET00", barcode: "3600531507664", category: "Makeup", stock: 2, reorderAt: 2, target: 8, unitCost: 9.09, salePrice: 14.45, supplier: "Collis Williams Ltd", icon: "✧", tint: "#f7e9ed" },
    { id: "p8", name: "Cancella Età Eye Corrector 03", sku: "MYFCET03", barcode: "3600530733866", category: "Makeup", stock: 3, reorderAt: 2, target: 8, unitCost: 9.07, salePrice: 14.45, supplier: "Collis Williams Ltd", icon: "✧", tint: "#f3e8e2" },
    { id: "p9", name: "Pure Collagen Firm Serum 30ml", sku: "CLFWPAAF", barcode: "8015150218016", category: "Professional skincare", stock: 1, reorderAt: 2, target: 5, unitCost: 25.32, salePrice: 41.50, supplier: "Collis Williams Ltd", icon: "◇", tint: "#eaf2ef" },
    { id: "p10", name: "Body Active Draining Superserum 200ml", sku: "CLBACSE", barcode: "8015150210597", category: "Professional skincare", stock: 1, reorderAt: 2, target: 5, unitCost: 30.81, salePrice: 50.50, supplier: "Collis Williams Ltd", icon: "◇", tint: "#edf1f5" },
    { id: "p11", name: "Firming Anti-Age Lifting Cream 200ml", sku: "CLBALICR", barcode: "8015150250593", category: "Professional skincare", stock: 1, reorderAt: 2, target: 5, unitCost: 21.97, salePrice: 35.95, supplier: "Collis Williams Ltd", icon: "◇", tint: "#f1ece7" },
    { id: "p12", name: "Sun Moist Tan Spray SPF30", sku: "CLSS30", barcode: "8015150260725", category: "Sun care", stock: 1, reorderAt: 2, target: 6, unitCost: 15.56, salePrice: 25.50, supplier: "Collis Williams Ltd", icon: "☀", tint: "#fff1db" }
  ],
  services: [],
  invoices: [
    { id: "020189", type: "Invoice", supplier: "Makiba Essence", date: "2026-06-04T09:30:00", items: 13, total: 290.53, status: "Imported" },
    { id: "93078111", type: "Invoice", supplier: "Collis Williams Ltd", date: "2026-05-14T10:00:00", items: 17, total: 139.18, status: "Imported" },
    { id: "93078033", type: "Invoice", supplier: "Collis Williams Ltd", date: "2026-05-11T10:00:00", items: 18, total: 433.56, status: "Imported" },
    { id: "97021711", type: "Credit Note", supplier: "Collis Williams Ltd", date: "2026-04-15T10:00:00", items: 21, total: 257.65, status: "Applied" }
  ],
  sales: [
    { id: "SAL-1048", date: "2026-07-14T10:32:00", units: 2, total: 56.08 },
    { id: "SAL-1047", date: "2026-07-14T09:48:00", units: 1, total: 28.90 },
    { id: "SAL-1046", date: "2026-07-13T17:21:00", units: 3, total: 84.85 }
  ],
  activities: [
    { type: "sale", title: "Sale SAL-1048 recorded", detail: "2 beauty products removed from inventory", date: "2026-07-14T10:32:00" },
    { type: "invoice", title: "Invoice 020189 imported", detail: "Makiba Essence · 13 units", date: "2026-06-04T09:30:00" },
    { type: "credit", title: "Credit note 97021711 applied", detail: "Collis Williams Ltd · 21 units returned", date: "2026-04-15T10:00:00" },
    { type: "alert", title: "Hydra Medic Serum is low", detail: "1 unit left · restock level: 2", date: "2026-07-14T08:12:00" }
  ]
};

let state = loadState();
let activeView = "dashboard";
let stockFilter = "all";
let serviceStatusFilter = "all";
let serviceCategoryFilter = "all";
let saleItemFilter = "all";
let saleBasket = [];
let saleBasketDiscount = 0;
let editingSaleId = null;
let scannerPurpose = "sale";
let scannerStream = null;
let scannerTimer = null;
let scannerDetecting = false;
let html5ScannerInstance = null;
let lastScannedBarcode = "";
let lastScanAt = 0;
let pendingDocumentFile = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currency = (value) => new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR" }).format(value);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const makeId = (prefix) => `${prefix}-${String(Date.now()).slice(-5)}`;
const SERVICE_CATEGORIES = ["Hair", "Nails", "Facials", "Massage", "Body treatments", "Waxing", "Makeup", "Spa packages", "Consultations", "Other"];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return normalizeState(saved?.products ? saved : structuredClone(seedData));
  } catch { return normalizeState(structuredClone(seedData)); }
}

function normalizeState(data) {
  const normalized = data && typeof data === "object" ? data : structuredClone(seedData);
  if (!Array.isArray(normalized.products)) normalized.products = [];
  if (!Array.isArray(normalized.services)) normalized.services = [];
  if (!Array.isArray(normalized.invoices)) normalized.invoices = [];
  if (!Array.isArray(normalized.sales)) normalized.sales = [];
  if (!Array.isArray(normalized.activities)) normalized.activities = [];
  normalized.services = normalized.services.map(service => ({
    ...service,
    active: service.active !== false,
    staff: Array.isArray(service.staff) ? service.staff : String(service.staff || "").split(",").map(name => name.trim()).filter(Boolean)
  }));
  normalized.products = normalized.products.map(product => ({
    ...product,
    classification:product.classification === "supply" ? "supply" : "resale"
  }));
  normalized.invoices = normalized.invoices.map(document => ({
    ...document,
    stockCategory:document.stockCategory === "supply" ? "supply" : "resale",
    stockApplied:document.stockApplied !== false
  }));
  return normalized;
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  window.VanitaCloud?.saveState(state);
}

function getStatus(product) {
  if (product.stock <= 0) return { label: "Out of stock", className: "out" };
  if (product.stock <= product.reorderAt) return { label: "Low stock", className: "low" };
  return { label: "In stock", className: "good" };
}

function isInInventory(product) { return product.inInventory !== false; }
function inventoryProducts() { return state.products.filter(isInInventory); }
function lowStockProducts() { return inventoryProducts().filter(p => p.stock <= p.reorderAt).sort((a, b) => a.stock - b.stock); }
function activeServices() { return state.services.filter(service => service.active !== false); }
function isResaleProduct(product) { return product?.classification !== "supply"; }
function sellableProducts() { return inventoryProducts().filter(product => isResaleProduct(product)); }
function saleLineType(line) { return line?.itemType === "service" || line?.serviceId ? "service" : "product"; }
function saleLineGross(line) { return Math.max(0, Number(line?.qty) || 0) * Math.max(0, Number(line?.unitPrice) || 0); }
function saleLineAfterDiscount(line) { return Math.max(0, saleLineGross(line) - Math.max(0, Number(line?.lineDiscount) || 0)); }
function saleRevenueSplit(sale) {
  if (!Array.isArray(sale.lines) || !sale.lines.length) return { product:Number(sale.total) || 0, service:0 };
  if (Number.isFinite(Number(sale.productRevenue)) && Number.isFinite(Number(sale.serviceRevenue))) return { product:Number(sale.productRevenue), service:Number(sale.serviceRevenue) };
  const afterLineDiscounts = sale.lines.reduce((sum, line) => sum + saleLineAfterDiscount(line), 0);
  const basketDiscount = Math.min(afterLineDiscounts, Math.max(0, Number(sale.basketDiscount) || 0));
  return sale.lines.reduce((totals, line) => {
    const net = saleLineAfterDiscount(line);
    const allocatedBasketDiscount = afterLineDiscounts ? basketDiscount * net / afterLineDiscounts : 0;
    totals[saleLineType(line)] += Math.max(0, net - allocatedBasketDiscount);
    return totals;
  }, { product:0, service:0 });
}
function saleItemCounts(sale) {
  if (!Array.isArray(sale.lines) || !sale.lines.length) return { product:Number(sale.units) || 0, service:0 };
  return sale.lines.reduce((totals, line) => {
    totals[saleLineType(line)] += Number(line.qty) || 0;
    return totals;
  }, { product:0, service:0 });
}

function renderAll() {
  renderMetrics();
  renderRestock();
  renderInventory();
  renderProducts();
  renderServices();
  renderInvoices();
  renderActivities();
  renderSales();
  renderChart();
  $("#inventoryCount").textContent = inventoryProducts().length;
  $("#notificationDot").hidden = lowStockProducts().length === 0;
}

function renderMetrics() {
  const stockedProducts = inventoryProducts();
  const totalUnits = stockedProducts.reduce((sum, p) => sum + p.stock, 0);
  const resaleProducts = stockedProducts.filter(isResaleProduct);
  const costValue = resaleProducts.reduce((sum, p) => sum + Math.max(0, Number(p.stock) || 0) * Math.max(0, Number(p.unitCost) || 0), 0);
  const retailValue = resaleProducts.reduce((sum, p) => sum + Math.max(0, Number(p.stock) || 0) * Math.max(0, Number(p.salePrice) || 0), 0);
  const missingCost = resaleProducts.filter(p => Number(p.stock) > 0 && !(Number(p.unitCost) > 0)).length;
  const missingRrp = resaleProducts.filter(p => Number(p.stock) > 0 && !(Number(p.salePrice) > 0)).length;
  const low = lowStockProducts().length;
  const salesToday = state.sales.filter(s => new Date(s.date).toDateString() === new Date().toDateString());
  const todaySales = salesToday.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const todaySplit = salesToday.reduce((totals, sale) => {
    const split = saleRevenueSplit(sale);
    totals.product += split.product;
    totals.service += split.service;
    return totals;
  }, { product:0, service:0 });
  const metrics = [
    { icon: "□", value: totalUnits.toLocaleString(), label: `${stockedProducts.length} products in inventory`, delta: "+6.2%", tone: "#347c65", tint: "#e7f3ee" },
    { icon: "€", value: currency(costValue), label: missingCost ? `${missingCost} stocked product${missingCost === 1 ? "" : "s"} missing cost` : "Current stock cost value", delta: missingCost ? "Cost needed" : "At cost", tone: "#6078ad", tint: "#edf0f8", warn: missingCost > 0 },
    { icon: "€", value: currency(retailValue), label: missingRrp ? `${missingRrp} stocked product${missingRrp === 1 ? "" : "s"} missing RRP` : "Potential retail value", delta: missingRrp ? "RRP needed" : "At RRP", tone: "#7669a7", tint: "#f0edf8", warn: missingRrp > 0 },
    { icon: "!", value: low, label: "Products need restocking", delta: low ? "Action needed" : "All good", tone: "#b57525", tint: "#fff2de", warn: true },
    { icon: "↗", value: currency(todaySales), label: "Sales recorded today", note:`Products ${currency(todaySplit.product)} · Services ${currency(todaySplit.service)}`, delta: salesToday.length ? `${salesToday.length} sale${salesToday.length === 1 ? "" : "s"}` : "No sales", tone: "#9b675c", tint: "#faece8" }
  ];
  $("#metricGrid").innerHTML = metrics.map(m => `<article class="metric-card" style="--tone:${m.tone};--tint:${m.tint}"><div class="metric-top"><span class="metric-icon">${m.icon}</span><span class="metric-delta ${m.warn ? "warn" : ""}">${m.delta}</span></div><strong class="metric-value">${m.value}</strong><span class="metric-label">${m.label}</span>${m.note ? `<small class="metric-note">${m.note}</small>` : ""}</article>`).join("");
}

function renderRestock() {
  const low = lowStockProducts().slice(0, 4);
  $("#restockList").innerHTML = low.length ? low.map(p => {
    const status = getStatus(p);
    return `<div class="restock-item"><span class="product-thumb" style="--thumb:${p.tint}">${p.icon}</span><div class="product-info"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.sku)} · ${escapeHtml(p.supplier)}</span></div><div class="stock-status" style="--status:${status.className === "out" ? "#bd584e" : "#b57525"}"><strong>${p.stock === 0 ? "Out of stock" : `${p.stock} left`}</strong><span>Restock at ${p.reorderAt}</span></div></div>`;
  }).join("") : `<div class="empty-mini">Everything is comfortably stocked.</div>`;
}

function renderInventory() {
  const query = ($("#inventorySearch")?.value || "").toLowerCase();
  let products = inventoryProducts().filter(p => [p.name, p.sku, p.category, p.barcode].some(v => String(v).toLowerCase().includes(query)));
  if (stockFilter === "low") products = products.filter(p => p.stock > 0 && p.stock <= p.reorderAt);
  if (stockFilter === "out") products = products.filter(p => p.stock <= 0);
  $("#resultCount").textContent = `${products.length} product${products.length === 1 ? "" : "s"}`;
  $("#inventoryTable").innerHTML = products.map(p => {
    const status = getStatus(p);
    return `<tr><td><div class="product-cell"><span class="product-thumb" style="--thumb:${p.tint}">${p.icon}</span><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.supplier || "No supplier")}</small></span></div></td><td>${escapeHtml(p.sku)}</td><td><span class="purpose-badge ${isResaleProduct(p) ? "resale" : "supply"}">${isResaleProduct(p) ? "Resale" : "Supply"}</span></td><td>${escapeHtml(p.category)}</td><td><span class="stock-number">${p.stock}</span> units</td><td>${p.reorderAt} units</td><td><span class="status-badge ${status.className}">${status.label}</span></td><td><button class="remove-stock-button" data-remove-inventory="${p.id}">Remove</button></td></tr>`;
  }).join("");
  $("#inventoryEmpty").classList.toggle("show", products.length === 0);
  $("#inventoryTable").parentElement.style.display = products.length ? "table" : "none";
}

function renderProducts() {
  const search = $("#productsSearch");
  const table = $("#productsTable");
  if (!search || !table) return;
  const query = search.value.trim().toLowerCase();
  const products = state.products.filter(p =>
    [p.name, p.sku, p.brand, p.supplier, p.category, p.barcode]
      .some(value => String(value || "").toLowerCase().includes(query))
  );
  $("#productsResultCount").textContent = `${products.length} product${products.length === 1 ? "" : "s"}`;
  table.innerHTML = products.map(p => `
    <tr>
      <td><div class="product-cell"><span class="product-thumb" style="--thumb:${p.tint}">${p.icon}</span><span><strong>${escapeHtml(p.name)}</strong><small>${p.stock} currently in stock</small></span></div></td>
      <td>${escapeHtml(p.sku || "—")}</td>
      <td><span class="purpose-badge ${isResaleProduct(p) ? "resale" : "supply"}">${isResaleProduct(p) ? "Resale" : "Supply"}</span></td>
      <td>${escapeHtml(p.brand || "—")}</td>
      <td>${escapeHtml(p.supplier || "—")}</td>
      <td>${escapeHtml(p.category || "Other")}</td>
      <td>${escapeHtml(p.barcode || "—")}</td>
      <td>${currency(Number(p.unitCost) || 0)}</td>
      <td><strong>${currency(Number(p.salePrice) || 0)}</strong></td>
      <td>${Number(p.reorderAt) || 0} units</td>
      <td><div class="row-actions"><button class="edit-product-button" data-edit-product="${p.id}">Edit</button><button class="delete-product-button" data-delete-product="${p.id}">Delete</button></div></td>
    </tr>`).join("");
  $("#productsEmpty").classList.toggle("show", products.length === 0);
  table.parentElement.style.display = products.length ? "table" : "none";
}

function renderServices() {
  const table = $("#servicesTable");
  if (!table) return;
  const search = $("#servicesSearch");
  const categorySelect = $("#serviceCategoryFilter");
  const query = (search?.value || "").trim().toLowerCase();
  const categories = [...new Set([...SERVICE_CATEGORIES, ...state.services.map(service => service.category).filter(Boolean)])];
  if (categorySelect) {
    categorySelect.innerHTML = `<option value="all">All categories</option>${categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
    categorySelect.value = categories.includes(serviceCategoryFilter) ? serviceCategoryFilter : "all";
  }
  const services = state.services.filter(service => {
    const matchesQuery = !query || [service.name, service.code, service.category, service.description, ...(service.staff || [])].some(value => String(value || "").toLowerCase().includes(query));
    const matchesCategory = serviceCategoryFilter === "all" || service.category === serviceCategoryFilter;
    const matchesStatus = serviceStatusFilter === "all" || (ser…13181 tokens truncated…nt, discountTotal:lineDiscountTotal + basketDiscount, total };
}

function renderCheckout() {
  const target = $("#checkoutLines");
  if (!target) return;
  const totals = getCheckoutTotals();
  totals.lineTotals.forEach(row => { row.line.lineDiscount = row.discount; });
  saleBasketDiscount = totals.basketDiscount;
  target.innerHTML = totals.lineTotals.map((row, index) => `<div class="checkout-line"><div><strong>${escapeHtml(row.item.name)}</strong><small>${row.line.qty} × ${currency(row.unitPrice)} · ${row.line.itemType === "product" ? "Product" : "Service"}</small></div><label><span>Line discount</span><div><span>€</span><input data-line-discount="${index}" type="number" min="0" max="${row.gross.toFixed(2)}" step="0.01" value="${row.discount.toFixed(2)}"></div></label><b>${currency(row.net)}</b></div>`).join("");
  const basketInput = $("#basketDiscount");
  if (basketInput && Number(basketInput.value) !== totals.basketDiscount) basketInput.value = totals.basketDiscount.toFixed(2);
  $("#checkoutSummary").innerHTML = `<div><span>Subtotal</span><strong>${currency(totals.subtotal)}</strong></div><div><span>Line discounts</span><strong>− ${currency(totals.lineDiscountTotal)}</strong></div><div><span>Basket discount</span><strong>− ${currency(totals.basketDiscount)}</strong></div><div class="checkout-total"><span>Amount due</span><strong>${currency(totals.total)}</strong></div>`;
}

function saveSale() {
  if (!saleBasket.length) return;
  const previousSale = editingSaleId ? state.sales.find(item => item.id === editingSaleId) : null;
  const insufficient = saleBasket.find(line => line.itemType === "product" && (Number(line.qty) || 0) > availableProductQty(line.itemId));
  if (insufficient) return showToast("Not enough stock", `${getBasketItem(insufficient).name} no longer has enough available stock.`);

  const oldProductLines = (previousSale?.lines || []).filter(line => saleLineType(line) === "product");
  oldProductLines.forEach(line => {
    const product = state.products.find(item => item.id === (line.productId || line.itemId));
    if (product) { product.stock += Number(line.qty) || 0; product.inInventory = true; }
  });

  const newlyLow = [];
  let productUnits = 0, serviceUnits = 0;
  const checkout = getCheckoutTotals();
  const saleLines = checkout.lineTotals.map(row => {
    const { line, item, unitPrice, discount } = row;
    const isProduct = line.itemType === "product";
    if (isProduct) {
      const product = state.products.find(entry => entry.id === line.itemId);
      if (product) {
        const wasLow = product.stock <= product.reorderAt;
        product.stock = Math.max(0, product.stock - line.qty);
        productUnits += line.qty;
        if (!wasLow && product.stock <= product.reorderAt) newlyLow.push(product);
      }
    } else serviceUnits += line.qty;
    return {
      itemType:line.itemType,
      itemId:line.itemId,
      ...(isProduct ? { productId:line.itemId } : { serviceId:line.itemId }),
      name:item?.name || line.name || "",
      qty:line.qty,
      unitPrice,
      lineDiscount:discount,
      ...(isProduct ? {} : { staff:line.staff || "", duration:Number(item?.duration || line.duration) || 0, vatRate:Number(item?.vatRate || line.vatRate) || 0, category:item?.category || line.category || "Other" })
    };
  });

  const provisional = { lines:saleLines, basketDiscount:checkout.basketDiscount };
  const split = saleRevenueSplit(provisional);
  const saleId = previousSale?.id || makeId("SAL");
  const now = new Date().toISOString();
  const detail = `${productUnits} product${productUnits === 1 ? "" : "s"} · ${serviceUnits} service${serviceUnits === 1 ? "" : "s"}${checkout.discountTotal ? ` · ${currency(checkout.discountTotal)} discount` : ""}`;
  const saleRecord = { id:saleId, date:previousSale?.date || now, updatedAt:previousSale ? now : undefined, units:productUnits, productUnits, serviceUnits, subtotal:checkout.subtotal, lineDiscountTotal:checkout.lineDiscountTotal, basketDiscount:checkout.basketDiscount, discountTotal:checkout.discountTotal, productRevenue:split.product, serviceRevenue:split.service, total:checkout.total, lines:saleLines };
  if (previousSale) Object.assign(previousSale, saleRecord);
  else state.sales.unshift(saleRecord);
  state.activities.unshift({ type:"sale", title:`Sale ${saleId} ${previousSale ? "updated" : "recorded"}`, detail, date:now });
  newlyLow.forEach(product => state.activities.unshift({ type:"alert", title:`${product.name} needs restocking`, detail:`${product.stock} left · restock at ${product.reorderAt}`, date:now }));
  saveState(); renderAll(); closeModal();
  showToast(previousSale ? "Sale updated" : "Sale completed", `${detail} · ${currency(checkout.total)} total.`);
  newlyLow.forEach(sendRestockNotification);
}

function normalizeBarcode(value) {
  const normalized = String(value || "").trim().replace(/[\s-]+/g, "").toUpperCase();
  if (/^\d{12}$/.test(normalized)) return `0${normalized}`;
  return normalized;
}

function barcodesMatch(left, right) {
  const a = normalizeBarcode(left), b = normalizeBarcode(right);
  return Boolean(a && b && a === b);
}

function findProductByBarcode(rawValue) {
  return sellableProducts().find(product => product.stock > 0 && barcodesMatch(product.barcode, rawValue));
}

function setScannerStatus(message, tone = "") {
  const status = $("#scannerStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function handleScannedBarcode(rawValue) {
  const barcode = String(rawValue || "").trim();
  if (!barcode) return;
  const now = Date.now();
  if (barcode === lastScannedBarcode && now - lastScanAt < 1800) return;
  lastScannedBarcode = barcode;
  lastScanAt = now;
  if (scannerPurpose === "product") {
    const form = $("#productForm");
    const currentId = form?.dataset.productId || "";
    const duplicate = state.products.find(item => item.id !== currentId && barcodesMatch(item.barcode, barcode));
    if (duplicate) {
      setScannerStatus(`Already assigned to ${duplicate.name}`, "error");
      showToast("Barcode already assigned", `${barcode} belongs to ${duplicate.name}.`);
      navigator.vibrate?.([60, 40, 60]);
      return;
    }
    if (form?.elements.barcode) form.elements.barcode.value = barcode;
    setScannerStatus(`Barcode ${barcode} captured`, "success");
    navigator.vibrate?.(80);
    showToast("Barcode captured", "Review the barcode, then save the product.");
    setTimeout(stopCamera, 350);
    return;
  }
  const product = findProductByBarcode(barcode);
  if (!product) {
    setScannerStatus(`Barcode ${barcode} detected — no in-stock product found`, "error");
    showToast("Barcode not found", `${barcode} is not assigned to an in-stock resale product.`);
    navigator.vibrate?.([60, 40, 60]);
    return;
  }
  addToBasket(product.id);
  setScannerStatus(`${product.name} added`, "success");
  navigator.vibrate?.(80);
  showToast("Product scanned", `${product.name} was added to the sale.`);
  setTimeout(stopCamera, 350);
}

function loadHtml5ScannerLibrary() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-barcode-fallback]");
    if (existing) {
      existing.addEventListener("load", resolve, { once:true });
      existing.addEventListener("error", reject, { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
    script.crossOrigin = "anonymous";
    script.dataset.barcodeFallback = "true";
    script.onload = resolve;
    script.onerror = () => reject(new Error("The barcode camera library could not be loaded."));
    document.head.append(script);
  });
}

async function startFallbackCameraScanner() {
  await loadHtml5ScannerLibrary();
  $("#scannerVideo").hidden = true;
  $("#html5Scanner").hidden = false;
  $("#cameraTarget").hidden = true;
  setScannerStatus("Looking for a barcode…");
  const formats = window.Html5QrcodeSupportedFormats;
  html5ScannerInstance = new window.Html5Qrcode("html5Scanner", {
    formatsToSupport:[formats.EAN_13, formats.EAN_8, formats.UPC_A, formats.UPC_E, formats.CODE_128, formats.CODE_39].filter(Boolean)
  });
  await html5ScannerInstance.start(
    { facingMode:"environment" },
    { fps:10, qrbox:{ width:260, height:120 }, aspectRatio:1.777778 },
    handleScannedBarcode,
    () => {}
  );
}

async function startCameraScanner() {
  if (!navigator.mediaDevices?.getUserMedia) return showToast("Camera scanning unavailable", "Type a barcode or use a handheld scanner instead.");
  stopCamera();
  $("#cameraStage").hidden = false;
  $("#scannerVideo").hidden = false;
  $("#html5Scanner").hidden = true;
  $("#cameraTarget").hidden = false;
  setScannerStatus("Starting camera…");
  lastScannedBarcode = "";
  lastScanAt = 0;
  if (!("BarcodeDetector" in window)) {
    try { await startFallbackCameraScanner(); }
    catch (error) { stopCamera(); showToast("Camera scanning unavailable", error.message || "Type the barcode instead."); }
    return;
  }
  try {
    const supported = await BarcodeDetector.getSupportedFormats?.() || [];
    const preferred = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39"];
    const formats = preferred.filter(format => !supported.length || supported.includes(format));
    const detector = formats.length ? new BarcodeDetector({ formats }) : new BarcodeDetector();
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:{ ideal:"environment" }, width:{ ideal:1280 }, height:{ ideal:720 } },
      audio:false
    });
    $("#scannerVideo").srcObject = scannerStream;
    await $("#scannerVideo").play();
    setScannerStatus("Point the camera at the product barcode");
    scannerTimer = setInterval(async () => {
      if (scannerDetecting) return;
      scannerDetecting = true;
      try {
        const codes = await detector.detect($("#scannerVideo"));
        if (codes[0]) handleScannedBarcode(codes[0].rawValue);
      } catch (error) {
        if (error?.name === "NotSupportedError") {
          stopCamera();
          $("#cameraStage").hidden = false;
          try { await startFallbackCameraScanner(); }
          catch { stopCamera(); showToast("Barcode reader unavailable", "Type the barcode or use a handheld scanner."); }
        }
      } finally {
        scannerDetecting = false;
      }
    }, 400);
  } catch (error) {
    stopCamera();
    if (error?.name === "NotAllowedError") showToast("Camera permission needed", "Allow camera access, then try again.");
    else {
      $("#cameraStage").hidden = false;
      try { await startFallbackCameraScanner(); }
      catch { stopCamera(); showToast("Camera scanning unavailable", "Type the barcode or use a handheld scanner instead."); }
    }
  }
}

function stopCamera() {
  if (scannerTimer) clearInterval(scannerTimer);
  scannerTimer = null;
  scannerDetecting = false;
  if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
  scannerStream = null;
  const fallback = html5ScannerInstance;
  html5ScannerInstance = null;
  if (fallback) Promise.resolve(fallback.stop()).catch(()=>{}).finally(()=>{ try { fallback.clear(); } catch {} });
  const video = $("#scannerVideo");
  if (video) { video.pause(); video.srcObject = null; video.hidden = false; }
  const fallbackStage = $("#html5Scanner");
  if (fallbackStage) { fallbackStage.hidden = true; fallbackStage.innerHTML = ""; }
  const target = $("#cameraTarget");
  if (target) target.hidden = false;
  const stage = $("#cameraStage");
  if (stage) stage.hidden = true;
}

async function enableNotifications() {
  if (!("Notification" in window)) return showToast("Notifications unavailable", "Your browser does not support system notifications.");
  const permission=await Notification.requestPermission();
  showToast(permission==="granted"?"Restock alerts enabled":"Notifications not enabled",permission==="granted"?"We’ll alert you when a sale creates low stock.":"You can still see alerts inside Vanita Stock.");
}
function sendRestockNotification(product){if("Notification" in window&&Notification.permission==="granted")new Notification("Vanita Stock restock alert",{body:`${product.name} has ${product.stock} units left. Restock level: ${product.reorderAt}.`,icon:"icon.svg"});}

function showToast(title, message) {
  const toast=document.createElement("div");toast.className="toast";toast.innerHTML=`<span>✓</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div><button aria-label="Dismiss">×</button>`;$("#toastRegion").append(toast);toast.querySelector("button").onclick=()=>toast.remove();setTimeout(()=>toast.remove(),4500);
}

function wireEvents() {
  $$('[data-view]').forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.view)));
  $$('[data-view-jump]').forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.viewJump)));
  $$('[data-action]').forEach(button=>button.addEventListener("click",()=>{const action=button.dataset.action;if(action==="scan-invoice")setupInvoiceModal();if(action==="record-sale")setupSaleModal();if(action==="add-product")setupProductModal();if(action==="add-service")setupServiceModal();if(action==="open-catalog")openCatalogMenu();}));
  $("#inventorySearch").addEventListener("input",renderInventory);
  $("#inventoryTable").addEventListener("click",event=>{const button=event.target.closest("[data-remove-inventory]");if(button)removeFromInventory(button.dataset.removeInventory);});
  $("#productsSearch").addEventListener("input",renderProducts);
  $("#productsTable").addEventListener("click",event=>{const editButton=event.target.closest("[data-edit-product]");const deleteButton=event.target.closest("[data-delete-product]");if(editButton)setupProductModal(editButton.dataset.editProduct);if(deleteButton)deleteProduct(deleteButton.dataset.deleteProduct);});
  $("#servicesSearch").addEventListener("input",renderServices);
  $("#serviceCategoryFilter").addEventListener("change",event=>{serviceCategoryFilter=event.target.value;renderServices();});
  $("#servicesTable").addEventListener("click",event=>{const editButton=event.target.closest("[data-edit-service]");const toggleButton=event.target.closest("[data-toggle-service]");const deleteButton=event.target.closest("[data-delete-service]");if(editButton)setupServiceModal(editButton.dataset.editService);if(toggleButton)toggleService(toggleButton.dataset.toggleService);if(deleteButton)deleteService(deleteButton.dataset.deleteService);});
  $$("[data-service-status]").forEach(button=>button.addEventListener("click",()=>{serviceStatusFilter=button.dataset.serviceStatus;$$("[data-service-status]").forEach(item=>item.classList.toggle("active",item===button));renderServices();}));
  $("#invoiceTable").addEventListener("click",event=>{const preview=event.target.closest("[data-preview-document]");const download=event.target.closest("[data-download-document]");const remove=event.target.closest("[data-delete-document]");if(preview)openStoredDocument(preview.dataset.previewDocument);if(download)openStoredDocument(download.dataset.downloadDocument,true);if(remove)deleteDocumentRecord(remove.dataset.deleteDocument);});
  $("#salesList").addEventListener("click",event=>{const edit=event.target.closest("[data-edit-sale]");const remove=event.target.closest("[data-delete-sale]");if(edit)setupSaleModal(edit.dataset.editSale);if(remove)deleteSale(remove.dataset.deleteSale);});
  $$('[data-stock-filter]').forEach(button=>button.addEventListener("click",()=>{stockFilter=button.dataset.stockFilter;$$('[data-stock-filter]').forEach(b=>b.classList.toggle("active",b===button));renderInventory();}));
  $$('[data-filter-low]').forEach(button=>button.addEventListener("click",()=>{stockFilter="low";$$('[data-stock-filter]').forEach(b=>b.classList.toggle("active",b.dataset.stockFilter==="low"));switchView("inventory");renderInventory();}));
  $("#menuButton").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
  $("#modalBackdrop").addEventListener("click",event=>{if(event.target===$("#modalBackdrop"))closeModal();});
  $("#enableAlerts").addEventListener("click",enableNotifications);
  $("#openGuide").addEventListener("click",()=>showToast("Three quick steps","Import an invoice to add stock, apply credit notes to returns, then record each sale."));
  $("#signOutButton").addEventListener("click",()=>window.VanitaCloud?.signOut());
  $("#globalSearch").addEventListener("input",event=>{
    const query=event.target.value.trim();
    if(!query)return;
    const lower=query.toLowerCase();
    const productMatch=state.products.some(item=>[item.name,item.sku,item.barcode,item.brand].some(value=>String(value||"").toLowerCase().includes(lower)));
    const serviceMatch=state.services.some(item=>[item.name,item.code,item.category].some(value=>String(value||"").toLowerCase().includes(lower)));
    if(serviceMatch&&!productMatch){switchView("services");$("#servicesSearch").value=query;renderServices();}
    else{switchView("products");$("#productsSearch").value=query;renderProducts();}
  });
  document.addEventListener("keydown",event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();$("#globalSearch").focus();}if(event.key==="Escape"&&!$("#modalBackdrop").hidden)closeModal();});
}

async function init() {
  $("#todayLabel").textContent=new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"}).toUpperCase();
  wireEvents();
  try {
    const cloud = await window.VanitaCloud?.connect();
    if (cloud?.enabled) {
      const sharedState = await window.VanitaCloud.loadState();
      if (sharedState?.products) state = normalizeState(sharedState);
      else window.VanitaCloud.saveState(state);
    }
  } catch (error) {
    console.error("Vanita cloud initialization failed", error);
    $("#cloudStatus").textContent = "Cloud unavailable";
  }
  renderAll();
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js").catch(()=>{}));
}

init();
