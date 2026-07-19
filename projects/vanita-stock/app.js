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
    const matchesStatus = serviceStatusFilter ==…33129 tokens truncated…ba(0,0,0,.55);color:white;cursor:pointer; }
.camera-stage #html5Scanner { width:100%;height:100%;background:#13201c; }
.camera-stage #html5Scanner video { width:100%!important;height:100%!important;object-fit:cover; }
.scanner-status { position:absolute;z-index:4;left:50%;bottom:12px;max-width:calc(100% - 28px);transform:translateX(-50%);padding:7px 11px;border-radius:99px;background:rgba(10,27,22,.78);color:white;font-size:9px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.scanner-status[data-tone="success"] { background:rgba(31,126,94,.92); }
.scanner-status[data-tone="error"] { background:rgba(165,69,61,.92); }
.toast-region { position:fixed;right:20px;bottom:20px;z-index:200;display:grid;gap:10px; }.toast { width:min(340px,calc(100vw - 40px));display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:center;padding:13px;border:1px solid #dfe8e3;border-radius:12px;background:white;box-shadow:var(--shadow);animation:toastIn .3s ease; }.toast>span { display:grid;width:30px;height:30px;place-items:center;border-radius:8px;background:var(--green-50);color:var(--green-600); }.toast strong { display:block;font-size:11px; }.toast p { margin:2px 0 0;color:var(--muted);font-size:9px; }.toast button { border:0;background:transparent;color:#9aa39f;cursor:pointer; } @keyframes toastIn{from{opacity:0;transform:translateY(8px)}}
.mobile-nav { display:none; }

.status-badge.credit { color:#96566f;background:#f8eaf0; }
.service-summary { display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin-bottom:16px; }
.service-summary .invoice-stat strong { max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.service-insights { display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px; }
.insight-list { padding:5px 20px 12px; }
.insight-list>div { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #eff1ef; }
.insight-list>div:last-child { border-bottom:0; }
.insight-list strong,.insight-list small { display:block; }
.insight-list strong { font-size:11px; }
.insight-list small { margin-top:3px;color:var(--muted);font-size:9px; }
.insight-list b { font:700 11px "Manrope"; }
.insight-list>p { padding:20px 0;text-align:center;color:var(--muted);font-size:10px; }
.toolbar-select { padding:8px 30px 8px 10px;border:1px solid var(--line);border-radius:9px;background:white;color:var(--ink);font-size:10px;outline:0; }
.service-thumb { color:#7669a7;background:#f0edf8!important; }
.edit-product-button { border:1px solid #d8e3de;border-radius:8px;padding:7px 11px;background:white;color:var(--green-600);font-size:10px;font-weight:700;cursor:pointer; }
.edit-product-button:hover { background:var(--green-50);border-color:#b8d0c6; }
.products-table td:first-child { min-width:220px; }
.row-actions { display:flex;gap:6px; }
.archive-service-button { border:1px solid #e8dec8;border-radius:8px;padding:7px 10px;background:white;color:#956d27;font-size:10px;font-weight:700;cursor:pointer; }
.archive-service-button:hover { background:#fff8e9; }
.remove-stock-button,.delete-product-button { border:1px solid #efd7d3;border-radius:8px;padding:7px 10px;background:white;color:#ad574f;font-size:10px;font-weight:700;cursor:pointer; }
.remove-stock-button:hover,.delete-product-button:hover { background:var(--red-bg); }
.document-actions,.row-actions { display:flex;align-items:center;gap:6px; }
.document-action-button { border:1px solid #d8e3de;border-radius:8px;padding:7px 9px;background:white;color:var(--green-600);font-size:9px;font-weight:700;cursor:pointer; }
.document-action-button:hover { background:var(--green-50); }
.service-form { padding-top:24px;padding-bottom:25px; }
.service-form .wide { grid-column:1/-1; }
.form-grid textarea { width:100%;padding:10px 11px;border:1px solid #dfe5e1;border-radius:9px;outline:0;resize:vertical;color:var(--ink);font:11px "DM Sans",sans-serif; }
.toggle-field { display:flex!important;grid-column:1/-1;align-items:center;grid-template-columns:auto 1fr!important;justify-self:start; }
.toggle-field input { width:auto!important; }
.sale-type-filters { display:flex;gap:6px;margin-top:10px; }
.item-type-badge { display:inline-flex;margin-left:5px;padding:2px 5px;border-radius:99px;font-size:7px;font-style:normal;font-weight:700;vertical-align:1px; }
.item-type-badge.product { color:#2b7e62;background:#e8f3ee; }
.item-type-badge.service { color:#6e61a1;background:#f0edf8; }
.suggestion-empty { padding:18px;text-align:center;color:var(--muted);font-size:10px; }
.basket-staff { display:flex!important;align-items:center;gap:6px;margin-top:7px!important;color:var(--muted);font-size:8px!important;font-weight:600; }
.basket-staff select { max-width:150px;padding:4px 20px 4px 6px;border:1px solid #dfe5e1;border-radius:6px;background:white;color:var(--ink);font-size:8px; }
.basket-staff-empty { display:block;margin-top:6px;color:#9aa49f;font-size:8px; }
.catalog-choices { display:grid;grid-template-columns:1fr 1fr;gap:12px; }
.catalog-choices button { display:grid;grid-template-columns:42px 1fr;grid-template-rows:auto auto;column-gap:12px;align-items:center;padding:18px;border:1px solid var(--line);border-radius:13px;background:white;text-align:left;cursor:pointer; }
.catalog-choices button:hover { border-color:#a8c6ba;background:#f9fcfa; }
.catalog-choices button>span { grid-row:1/3;display:grid;width:42px;height:42px;place-items:center;border-radius:11px;background:var(--green-50);color:var(--green-600);font-size:20px; }
.catalog-choices strong { font:700 13px "Manrope"; }
.catalog-choices small { margin-top:3px;color:var(--muted);font-size:9px;line-height:1.4; }
.delete-record-button { border:1px solid #efd7d3;border-radius:8px;padding:7px 9px;background:white;color:#ad574f;font-size:9px;font-weight:700;cursor:pointer; }
.delete-record-button:hover { background:var(--red-bg); }
.file-unavailable { color:#9aa49f;font-size:9px; }
#salesList .activity-item { grid-template-columns:38px 1fr auto auto; }
.invoice-review-footer { justify-content:space-between;align-items:center;gap:18px; }
.review-totals { display:grid;grid-template-columns:repeat(5,auto);gap:18px;align-items:end; }
.review-totals span,.review-totals label { display:grid;gap:3px; }
.review-totals small { color:var(--muted);font-size:8px;white-space:nowrap; }
.review-totals strong { font:700 12px "Manrope";white-space:nowrap; }
.review-totals input { width:72px;padding:4px 6px;border:1px solid #dfe5e1;border-radius:6px;font:700 11px "Manrope"; }
.invoice-footer-actions { display:flex;gap:9px;flex-shrink:0; }
.document-type { display:inline-flex;padding:4px 8px;border-radius:99px;font-size:9px;font-weight:700; }
.document-type.invoice { color:#6078ad;background:#edf0f8; }
.document-type.credit { color:#96566f;background:#f8eaf0; }
.purpose-badge { display:inline-flex;padding:4px 8px;border-radius:99px;font-size:9px;font-weight:750;white-space:nowrap; }
.purpose-badge.resale { color:#276c56;background:#e7f3ee; }
.purpose-badge.supply { color:#8a6826;background:#fff2de; }
.status-badge.neutral { color:#65716c;background:#eef1ef; }
.barcode-field>div { display:flex;gap:7px;align-items:center; }
.barcode-field>div input { min-width:0;flex:1; }
.barcode-field>div button { flex:0 0 auto;padding:10px 12px; }
.checkout-heading { margin-bottom:18px; }
.checkout-heading h3 { margin:4px 0 5px;font:800 20px "Manrope"; }
.checkout-heading>p:last-child { margin:0;color:var(--muted);font-size:10px; }
.checkout-lines { display:grid;border:1px solid var(--line);border-radius:13px;overflow:hidden; }
.checkout-line { display:grid;grid-template-columns:minmax(0,1fr) 150px 85px;gap:14px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--line); }
.checkout-line:last-child { border-bottom:0; }
.checkout-line strong,.checkout-line small { display:block; }
.checkout-line strong { font-size:11px; }.checkout-line small { margin-top:3px;color:var(--muted);font-size:9px; }
.checkout-line label>span,.basket-discount-field>span { display:block;margin-bottom:4px;color:var(--muted);font-size:8px;font-weight:700; }
.checkout-line label>div,.basket-discount-field>div { display:flex;align-items:center;border:1px solid #dfe5e1;border-radius:8px;background:white;overflow:hidden; }
.checkout-line label>div span,.basket-discount-field>div span { padding-left:9px;color:var(--muted);font-size:10px; }
.checkout-line input,.basket-discount-field input { width:100%;padding:8px;border:0;outline:0;font-size:10px; }
.checkout-line>b { text-align:right;font-size:11px; }
.basket-discount-field { display:grid;grid-template-columns:1fr 150px;align-items:end;gap:14px;margin:16px 0;padding:14px;border-radius:12px;background:#f6f8f6; }
.checkout-summary { display:grid;gap:8px;margin-left:auto;max-width:340px; }
.checkout-summary>div { display:flex;justify-content:space-between;gap:30px;color:var(--muted);font-size:10px; }
.checkout-summary strong { color:var(--ink); }
.checkout-summary .checkout-total { margin-top:3px;padding-top:11px;border-top:1px solid var(--line);font-size:14px;font-weight:800;color:var(--ink); }

.auth-screen { position:fixed;z-index:500;inset:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 10%,rgba(90,169,139,.2),transparent 34%),linear-gradient(145deg,#0d2922,#17463a); }
.auth-card { width:min(420px,100%);padding:34px;border-radius:24px;background:white;box-shadow:0 30px 80px rgba(0,0,0,.3); }
.auth-brand { display:flex;align-items:center;gap:11px;margin-bottom:34px; }.auth-brand>span { display:grid;width:38px;height:38px;place-items:center;border-radius:11px;color:white;background:linear-gradient(145deg,#4fa989,#246f58);font-size:20px; }.auth-brand strong,.auth-brand small { display:block; }.auth-brand strong { font:800 17px "Manrope"; }.auth-brand small { margin-top:2px;color:var(--muted);font-size:10px; }
.auth-card h1 { margin:4px 0 7px;font:800 28px "Manrope"; }.auth-card>p:not(.eyebrow) { margin:0 0 24px;color:var(--muted);font-size:12px; }.auth-card form { display:grid;gap:15px; }.auth-card label { display:grid;gap:7px;color:#4e5d58;font-size:10px;font-weight:700; }.auth-card input { width:100%;padding:12px;border:1px solid #dfe5e1;border-radius:10px;outline:0;font-size:12px; }.auth-error { margin:0;padding:10px;border-radius:8px;color:#9c4038;background:var(--red-bg);font-size:10px; }.auth-help { display:block;margin-top:18px;color:#8b9692;text-align:center;font-size:9px; }
.cloud-status { padding:5px 8px;border-radius:99px;color:#78663e;background:#fff4dd;font-size:9px;font-weight:700;white-space:nowrap; }.cloud-status.online { color:var(--green-600);background:var(--green-50); }
.sign-out-button { display:grid;width:29px;height:29px;place-items:center;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#bdd0c8;background:rgba(255,255,255,.05);cursor:pointer; }

@media (max-width: 1050px) {
  .metric-grid { grid-template-columns:repeat(2,1fr); }.dashboard-grid { grid-template-columns:1fr; }.stock-chart-panel { min-height:300px; }.sales-layout{grid-template-columns:1fr 280px}.view{padding-left:28px;padding-right:28px}.topbar{padding:0 28px}
}
@media (max-width: 780px) {
  .cloud-status{display:none}
  body { padding-bottom:69px; }.app-shell{display:block}.sidebar{transform:translateX(-100%);box-shadow:20px 0 50px rgba(0,0,0,.25);transition:.25s ease}.sidebar.open{transform:translateX(0)}.main-content{width:100%}.topbar{height:65px;padding:0 16px}.menu-button{display:grid}.top-search{width:auto;flex:1}.top-search kbd{display:none}.top-actions .alert-button{display:none}.top-actions .primary-button{display:none}.view{padding:24px 16px 35px}.page-heading{align-items:flex-start;flex-direction:column;margin-bottom:20px}.page-heading .heading-actions{width:100%}.page-heading .heading-actions button{flex:1}.metric-grid{grid-template-columns:1fr 1fr;gap:10px}.metric-card{padding:15px;min-height:120px}.metric-value{font-size:20px}.dashboard-grid{gap:12px}.restock-panel,.stock-chart-panel,.activity-panel{padding:16px}.toolbar{align-items:stretch;flex-wrap:wrap}.table-search{flex:1;min-width:100%}.filter-chips{overflow:auto}.result-count{display:none}.invoice-summary{grid-template-columns:1fr}.sales-layout{grid-template-columns:1fr}.scan-card{display:none}.mobile-nav{position:fixed;z-index:40;display:grid;grid-template-columns:repeat(5,1fr);left:0;right:0;bottom:0;height:67px;padding:7px 8px calc(5px + env(safe-area-inset-bottom));border-top:1px solid #e2e6e3;background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}.mobile-nav button{display:grid;place-items:center;gap:1px;border:0;background:transparent;color:#8a9691;font-size:8px}.mobile-nav button span{font-size:17px}.mobile-nav button.active{color:var(--green-600)}.mobile-nav .mobile-scan span{display:grid;width:43px;height:43px;place-items:center;margin-top:-24px;border:4px solid var(--cream);border-radius:50%;background:var(--green-600);color:white;box-shadow:0 5px 15px rgba(25,92,71,.25)}.modal-backdrop{padding:0;place-items:end center}.modal{width:100%;max-height:93vh;border-radius:20px 20px 0 0}.form-grid{grid-template-columns:1fr}.product-form .wide{grid-column:auto}.camera-button span{display:none}.modal-header,.modal-body{padding-left:18px;padding-right:18px}.modal-footer{padding-left:18px;padding-right:18px}.review-table th,.review-table td{padding:7px}.activity-time{display:none}
}
@media (max-width: 430px) {
  .metric-grid{grid-template-columns:1fr}.metric-card{min-height:105px}.metric-value{margin-top:8px}.top-search input::placeholder{color:transparent}.page-heading h1{font-size:26px}.heading-actions{width:100%}.heading-actions button{flex:1}.stepper i{width:28px}.review-notice em{display:none}.sale-footer{align-items:flex-end}.sale-footer>div:last-child .secondary-button{display:none}
}

@media (max-width: 780px) {
  .mobile-nav { grid-template-columns:repeat(6,1fr); }
  .invoice-review-footer { align-items:stretch;flex-direction:column; }
  .review-totals { grid-template-columns:repeat(3,1fr);gap:10px; }
  .invoice-footer-actions { justify-content:flex-end; }
  .checkout-line { grid-template-columns:1fr 120px; }
  .checkout-line>b { grid-column:2;text-align:right; }
}

@media (max-width: 1050px) {
  .service-summary { grid-template-columns:repeat(2,1fr); }
}
@media (max-width: 780px) {
  .toolbar-select { flex:1; }
  .service-form .wide { grid-column:auto; }
  .catalog-choices { grid-template-columns:1fr 1fr; }
  .service-insights { grid-template-columns:1fr; }
}
@media (max-width: 430px) {
  .service-summary,.catalog-choices { grid-template-columns:1fr; }
  .checkout-line { grid-template-columns:1fr;gap:9px; }
  .checkout-line>b { grid-column:auto;text-align:left; }
  .basket-discount-field { grid-template-columns:1fr; }
}
