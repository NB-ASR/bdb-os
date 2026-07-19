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
    const matchesStatus = serviceStatusFilter === "all" || (serviceStatusFilter === "active" ? service.active !== false : service.active === false);
    return matchesQuery && matchesCategory && matchesStatus;
  });
  $("#servicesResultCount").textContent = `${services.length} service${services.length === 1 ? "" : "s"}`;
  table.innerHTML = services.map(service => `
    <tr>
      <td><div class="product-cell"><span class="product-thumb service-thumb">✦</span><span><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.description || "No description")}</small></span></div></td>
      <td>${escapeHtml(service.code || "—")}</td>
      <td>${escapeHtml(service.category || "Other")}</td>
      <td>${Number(service.duration) || 0} min</td>
      <td>${currency(Number(service.cost) || 0)}</td>
      <td><strong>${currency(Number(service.price) || 0)}</strong></td>
      <td>${Number(service.vatRate) || 0}%</td>
      <td>${escapeHtml((service.staff || []).join(", ") || "Any staff")}</td>
      <td><span class="status-badge ${service.active === false ? "out" : "good"}">${service.active === false ? "Inactive" : "Active"}</span></td>
      <td><div class="row-actions"><button class="edit-product-button" data-edit-service="${service.id}">Edit</button><button class="archive-service-button" data-toggle-service="${service.id}">${service.active === false ? "Activate" : "Archive"}</button><button class="delete-product-button" data-delete-service="${service.id}">Delete</button></div></td>
    </tr>`).join("");
  $("#servicesEmpty").classList.toggle("show", services.length === 0);
  table.parentElement.style.display = services.length ? "table" : "none";
  renderServiceSummary();
}

function renderServiceSummary() {
  const summary = $("#serviceSummary");
  if (!summary) return;
  const now = new Date();
  const monthLines = state.sales
    .filter(sale => {
      const date = new Date(sale.date);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    })
    .flatMap(sale => {
      if (!Array.isArray(sale.lines)) return [];
      const afterLineDiscounts = sale.lines.reduce((sum, line) => sum + saleLineAfterDiscount(line), 0);
      const basketDiscount = Math.min(afterLineDiscounts, Math.max(0, Number(sale.basketDiscount) || 0));
      return sale.lines.map(line => {
        const net = saleLineAfterDiscount(line);
        return { ...line, netRevenue:Math.max(0, net - (afterLineDiscounts ? basketDiscount * net / afterLineDiscounts : 0)) };
      });
    })
    .filter(line => saleLineType(line) === "service");
  const units = monthLines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  const revenue = monthLines.reduce((sum, line) => sum + (Number(line.netRevenue) || 0), 0);
  const popularity = monthLines.reduce((counts, line) => {
    const key = line.serviceId || line.itemId || line.name || "Service";
    if (!counts[key]) counts[key] = { name:line.name || "Service", qty:0 };
    counts[key].qty += Number(line.qty) || 0;
    return counts;
  }, {});
  const topService = Object.values(popularity).sort((a, b) => b.qty - a.qty)[0];
  summary.innerHTML = [
    ["✦", activeServices().length, "Active services"],
    ["↗", units, "Services sold this month"],
    ["€", currency(revenue), "Service revenue this month"],
    ["★", topService ? `${topService.name} (${topService.qty})` : "No sales yet", "Most popular this month"]
  ].map(([icon, value, label]) => `<div class="invoice-stat"><span>${icon}</span><div><strong>${escapeHtml(value)}</strong><small>${label}</small></div></div>`).join("");
  const buildBreakdown = keyForLine => Object.values(monthLines.reduce((groups, line) => {
    const key = keyForLine(line);
    if (!groups[key]) groups[key] = { name:key, qty:0, revenue:0 };
    groups[key].qty += Number(line.qty) || 0;
    groups[key].revenue += Number(line.netRevenue) || 0;
    return groups;
  }, {})).sort((a, b) => b.revenue - a.revenue);
  const renderBreakdown = (target, rows) => {
    if (!target) return;
    target.innerHTML = rows.length ? rows.map(row => `<div><span><strong>${escapeHtml(row.name)}</strong><small>${row.qty} service${row.qty === 1 ? "" : "s"}</small></span><b>${currency(row.revenue)}</b></div>`).join("") : `<p>No service sales recorded this month.</p>`;
  };
  renderBreakdown($("#serviceCategoryReport"), buildBreakdown(line => {
    const service = state.services.find(item => item.id === (line.serviceId || line.itemId));
    return service?.category || line.category || "Other";
  }));
  renderBreakdown($("#serviceStaffReport"), buildBreakdown(line => line.staff || "Unassigned"));
}

function renderInvoices() {
  const invoices = state.invoices.filter(document => (document.type || "Invoice") === "Invoice");
  const credits = state.invoices.filter(document => document.type === "Credit Note");
  const netPurchases = invoices.reduce((sum, document) => sum + document.total, 0) - credits.reduce((sum, document) => sum + document.total, 0);
  $("#invoiceSummary").innerHTML = [
    ["▤", invoices.length, "Supplier invoices"], ["↩", credits.length, "Credit notes applied"], ["€", currency(netPurchases), "Net purchases"]
  ].map(([icon, value, label]) => `<div class="invoice-stat"><span>${icon}</span><div><strong>${value}</strong><small>${label}</small></div></div>`).join("");
  $("#invoiceTable").innerHTML = state.invoices.map(document => {
    const type = document.type || "Invoice";
    const signedTotal = type === "Credit Note" ? -document.total : document.total;
    const fileActions = document.file?.path
      ? `<button class="document-action-button" data-preview-document="${escapeHtml(document.id)}">Preview</button><button class="document-action-button" data-download-document="${escapeHtml(document.id)}">Download</button>`
      : `<span class="file-unavailable">Original unavailable</span>`;
    const purpose = document.stockCategory === "supply" ? "Supplies" : "Resale";
    return `<tr><td><strong>${escapeHtml(document.id)}</strong></td><td><span class="document-type ${type === "Credit Note" ? "credit" : "invoice"}">${escapeHtml(type)}</span></td><td><span class="purpose-badge ${document.stockCategory === "supply" ? "supply" : "resale"}">${purpose}</span></td><td>${escapeHtml(document.supplier)}</td><td>${new Date(document.date).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}</td><td>${document.items}</td><td>${currency(signedTotal)}</td><td><span class="status-badge ${document.stockApplied === false ? "neutral" : type === "Credit Note" ? "credit" : "good"}">${document.status}</span></td><td><div class="document-actions">${fileActions}<button class="delete-record-button" data-delete-document="${escapeHtml(document.id)}">Delete</button></div></td></tr>`;
  }).join("");
}

function activityMarkup(activity) {
  const types = { sale: ["↗", "#e8f3ee", "#2b7e62"], invoice: ["▤", "#edf0f8", "#657ab0"], credit: ["↩", "#f8eaf0", "#9d5c76"], alert: ["!", "#fff0e2", "#b47527"] };
  const [icon, bg, color] = types[activity.type] || types.invoice;
  return `<div class="activity-item"><span class="activity-icon" style="--bg:${bg};--color:${color}">${icon}</span><div><strong>${escapeHtml(activity.title)}</strong><p>${escapeHtml(activity.detail)}</p></div><span class="activity-time">${relativeTime(activity.date)}</span></div>`;
}

function renderActivities() { $("#activityList").innerHTML = state.activities.slice(0, 5).map(activityMarkup).join(""); }
function renderSales() {
  $("#salesList").innerHTML = state.sales.length ? state.sales.map(s => {
    const counts = saleItemCounts(s);
    const parts = [];
    if (counts.product) parts.push(`${counts.product} product${counts.product === 1 ? "" : "s"}`);
    if (counts.service) parts.push(`${counts.service} service${counts.service === 1 ? "" : "s"}`);
    if (!parts.length) parts.push("No item breakdown");
    const staff = [...new Set((s.lines || []).filter(line => saleLineType(line) === "service" && line.staff).map(line => line.staff))];
    const discount = Math.max(0, Number(s.discountTotal) || 0);
    const detail = `${parts.join(" · ")}${staff.length ? ` · Staff: ${staff.join(", ")}` : ""}${discount ? ` · Discount ${currency(discount)}` : ""}`;
    return `<div class="activity-item">
      <span class="activity-icon" style="--bg:#e8f3ee;--color:#2b7e62">↗</span>
      <div><strong>Sale ${escapeHtml(s.id)} · ${currency(s.total)}</strong><p>${escapeHtml(detail)}</p></div>
      <span class="activity-time">${relativeTime(s.date)}</span>
      <div class="row-actions"><button class="document-action-button" data-edit-sale="${escapeHtml(s.id)}">Open / edit</button><button class="delete-record-button" data-delete-sale="${escapeHtml(s.id)}">Delete</button></div>
    </div>`;
  }).join("") : `<div class="empty-mini">No sales recorded yet.</div>`;
}

async function openStoredDocument(documentId, download = false) {
  const record = state.invoices.find(item => item.id === documentId);
  if (!record?.file?.path) return showToast("Original unavailable", "This older record was created before original-file storage was enabled.");
  const previewWindow = download ? null : window.open("", "_blank");
  try {
    const url = await window.VanitaCloud.getDocumentUrl(record.file.path, download ? record.file.name : null);
    if (download) {
      const link = document.createElement("a");
      link.href = url;
      link.download = record.file.name || "document";
      document.body.append(link);
      link.click();
      link.remove();
    } else if (previewWindow) {
      previewWindow.location = url;
    } else {
      window.open(url, "_blank");
    }
  } catch (error) {
    if (previewWindow) previewWindow.close();
    showToast("File could not be opened", error.message || "Please try again.");
  }
}

function deleteSale(saleId) {
  const sale = state.sales.find(item => item.id === saleId);
  if (!sale) return;
  const hasBreakdown = Array.isArray(sale.lines) && sale.lines.length > 0;
  const productLines = hasBreakdown ? sale.lines.filter(line => saleLineType(line) === "product") : [];
  const message = hasBreakdown
    ? `Delete sale ${sale.id}?\n\nThe sale record will be removed. Product quantities will be restored to Inventory; services do not affect stock.`
    : `Delete sale ${sale.id}?\n\nThis older sale has no saved item breakdown, so its stock cannot be restored. Only the sale record will be removed.`;
  if (!window.confirm(message)) return;
  if (hasBreakdown) {
    productLines.forEach(line => {
      const product = state.products.find(item => item.id === (line.productId || line.itemId));
      if (product) {
        product.stock += Number(line.qty) || 0;
        product.inInventory = true;
      }
    });
  }
  state.sales = state.sales.filter(item => item.id !== saleId);
  state.activities.unshift({ type:"alert", title:`Sale ${sale.id} deleted`, detail:hasBreakdown ? `${productLines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)} product units restored; service lines removed` : "Legacy record removed without stock adjustment", date:new Date().toISOString() });
  saveState(); renderAll();
  showToast("Sale deleted", hasBreakdown ? "Product quantities were restored; service lines were removed without changing stock." : "The legacy sale record was removed.");
}

async function deleteDocumentRecord(documentId) {
  const record = state.invoices.find(item => item.id === documentId);
  if (!record) return;
  const canReverse = record.stockApplied !== false && Array.isArray(record.lines) && record.lines.length > 0;
  const message = canReverse
    ? `Delete ${record.type || "document"} ${record.id}?\n\nThe document record and original file will be removed, and its stock movement will be reversed.`
    : record.stockApplied === false
      ? `Delete ${record.type || "document"} ${record.id}?\n\nThis document was uploaded without changing stock, so only its record and original file will be removed.`
      : `Delete ${record.type || "document"} ${record.id}?\n\nThis older record has no saved product breakdown, so stock cannot be reversed. Only the document record will be removed.`;
  if (!window.confirm(message)) return;
  try {
    if (record.file?.path) await window.VanitaCloud.deleteDocumentFile(record.file.path);
  } catch (error) {
    return showToast("Document not deleted", error.message || "The stored file could not be removed.");
  }
  if (canReverse) {
    record.lines.forEach(line => {
      const normalizedSku = String(line.sku || "").trim().toLowerCase();
      const normalizedName = String(line.name || "").trim().toLowerCase();
      const product = state.products.find(item =>
        (normalizedSku && String(item.sku || "").trim().toLowerCase() === normalizedSku) ||
        String(item.name || "").trim().toLowerCase() === normalizedName
      );
      if (!product) return;
      if (Number(record.direction) === -1) product.stock += Number(line.qty) || 0;
      else product.stock = Math.max(0, product.stock - (Number(line.qty) || 0));
      product.inInventory = true;
    });
  }
  state.invoices = state.invoices.filter(item => item.id !== documentId);
  state.activities.unshift({ type:"alert", title:`${record.type || "Document"} ${record.id} deleted`, detail:canReverse ? "Stock movement reversed" : "Legacy record removed without stock adjustment", date:new Date().toISOString() });
  saveState(); renderAll();
  showToast("Document deleted", canReverse ? "Its stock movement was reversed." : record.stockApplied === false ? "No stock quantities were changed." : "The legacy document record was removed.");
}

function relativeTime(date) {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(date).toLocaleDateString("en-GB", { day:"numeric", month:"short" });
}

function renderChart() {
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const stockIn = [58,92,46,110,76,128,65], stockOut = [36,55,68,52,87,73,42];
  $("#stockChart").innerHTML = days.map((day, i) => `<div class="chart-day"><div class="bar-pair"><i class="bar in" style="height:${stockIn[i]}px"></i><i class="bar out" style="height:${stockOut[i]}px"></i></div><span>${day}</span></div>`).join("");
}

function switchView(view) {
  activeView = view;
  $$(".view").forEach(el => el.classList.toggle("active", el.id === `${view}View`));
  $$('[data-view]').forEach(el => el.classList.toggle("active", el.dataset.view === view));
  $(".mobile-catalog")?.classList.toggle("active", view === "products" || view === "services");
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top:0, behavior:"smooth" });
}

function openModal(templateId) {
  const template = $(templateId);
  $("#modal").innerHTML = "";
  $("#modal").append(template.content.cloneNode(true));
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $$('[data-close-modal]', $("#modal")).forEach(button => button.addEventListener("click", closeModal));
}

function closeModal() {
  stopCamera();
  $("#modalBackdrop").hidden = true;
  document.body.style.overflow = "";
  saleBasket = [];
  saleBasketDiscount = 0;
  editingSaleId = null;
  scannerPurpose = "sale";
  pendingDocumentFile = null;
}

function setupInvoiceModal() {
  openModal("#scanInvoiceTemplate");
  const fileInput = $("#invoiceFile"), zone = $("#uploadZone");
  $("#chooseInvoice").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => fileInput.files[0] && processInvoice(fileInput.files[0]));
  ["dragenter","dragover"].forEach(event => zone.addEventListener(event, e => { e.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave","drop"].forEach(event => zone.addEventListener(event, e => { e.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", e => e.dataTransfer.files[0] && processInvoice(e.dataTransfer.files[0]));
}

async function processInvoice(file) {
  if (file.size > 3 * 1024 * 1024) return showToast("File is too large", "Choose an image or PDF under 3 MB.");
  if (!file.type.match(/^image\//) && file.type !== "application/pdf") return showToast("Unsupported document", "Choose a JPG, PNG or PDF invoice.");
  $("#uploadZone").hidden = true;
  $("#processingState").hidden = false;
  try {
    const token = await window.VanitaCloud?.getAccessToken();
    if (!token) throw new Error("Your staff session has expired. Sign in again and retry.");
    const fileData = await readFileAsDataUrl(file);
    const response = await fetch("/api/extract-document", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ fileName:file.name, mimeType:file.type, fileData })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The document could not be extracted.");
    showInvoiceReview(file, result.document);
  } catch (error) {
    $("#processingState").hidden = true;
    $("#uploadZone").hidden = false;
    showToast("Extraction failed", error.message || "Try a clearer image or PDF.");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
}

function showInvoiceReview(file, extracted = {}) {
  pendingDocumentFile = file;
  const fileName = file.name || "Uploaded document";
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const suggestedId = baseName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const looksLikeCredit = extracted.document_type === "Credit Note" || /credit|credit-note|credit_note|\bcn\b/i.test(baseName);
  $("#processingState").hidden = true;
  $("#reviewState").hidden = false;
  $("#importInvoice").hidden = false;
  $("#uploadInvoice").hidden = false;
  const steps = $$(".stepper div"); steps[0].classList.remove("active"); steps[1].classList.add("active");
  const confidence = Math.round(Math.max(0, Math.min(1, Number(extracted.confidence) || 0)) * 100);
  $("#reviewFileName").textContent = `${fileName} was extracted automatically. Review the highlighted fields and edit only if needed.`;
  $("#extractionConfidence").textContent = confidence ? `${confidence}% confidence` : "AI extraction";
  $("#reviewSupplier").value = extracted.supplier || "";
  $("#reviewDocumentType").value = looksLikeCredit ? "Credit Note" : "Invoice";
  $("#reviewStockCategory").value = "resale";
  $("#reviewInvoiceNumber").value = extracted.document_number || suggestedId || `DOC-${Date.now()}`;
  $("#reviewDocumentDate").value = /^\d{4}-\d{2}-\d{2}$/.test(extracted.document_date || "") ? extracted.document_date : new Date().toISOString().slice(0, 10);
  const extractedRows = Array.isArray(extracted.items) ? extracted.items.map(item => ({
    name:item.name || item.description || "",
    sku:item.sku || item.stock_code || "",
    barcode:item.barcode || "",
    qty:Number(item.quantity) || 1,
    cost:Number(item.unit_cost) || 0,
    rrp:Number(item.rrp) || 0
  })).filter(item => item.name || item.sku) : [];
  const rows = extractedRows.length ? extractedRows : [{ name:"", sku:"", barcode:"", qty:1, cost:0, rrp:0 }];
  $("#reviewItems").innerHTML = rows.map(reviewLineMarkup).join("");
  $("#reviewTotals").hidden = false;
  $("#reviewVatRate").value = "18.00";
  $("#addReviewLine").addEventListener("click", () => { $("#reviewItems").insertAdjacentHTML("beforeend", reviewLineMarkup({name:"",sku:"",barcode:"",qty:1,cost:0,rrp:0})); updateReviewTotals(); });
  $("#reviewItems").addEventListener("input", updateReviewTotals);
  $("#reviewItems").addEventListener("click", event => { if (event.target.closest(".remove-line")) { event.target.closest("tr").remove(); updateReviewTotals(); } });
  $("#reviewVatRate").addEventListener("input", updateReviewTotals);
  $("#reviewDocumentType").addEventListener("change", updateDocumentImportAction);
  $("#importInvoice").addEventListener("click", () => saveReviewedDocument(true));
  $("#uploadInvoice").addEventListener("click", () => saveReviewedDocument(false));
  updateDocumentImportAction();
  updateReviewTotals();
  showToast("Document ready to review", `${fileName} was processed successfully.`);
}

function getReviewTotals() {
  const rows = $$("#reviewItems tr").map(row => ({
    name:$(".line-name", row)?.value.trim() || "",
    quantity:Math.max(0, Number($(".line-qty", row)?.value) || 0),
    unitCost:Math.max(0, Number($(".line-cost", row)?.value) || 0),
    rrp:Math.max(0, Number($(".line-rrp", row)?.value) || 0)
  })).filter(line => line.name && line.quantity > 0);
  const totalQuantity = rows.reduce((sum, line) => sum + line.quantity, 0);
  const netAmount = rows.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const totalRrp = rows.reduce((sum, line) => sum + line.quantity * line.rrp, 0);
  const vatRate = Math.max(0, Number($("#reviewVatRate")?.value) || 0);
  const vat = netAmount * vatRate / 100;
  return { totalQuantity, netAmount, totalRrp, vatRate, vat, grossAmount:netAmount + vat };
}

function updateReviewTotals() {
  if (!$("#reviewTotals")) return;
  const { totalQuantity, netAmount, totalRrp, vat, grossAmount } = getReviewTotals();
  $("#reviewTotalQuantity").textContent = totalQuantity.toLocaleString();
  $("#reviewNetAmount").textContent = currency(netAmount);
  $("#reviewVatAmount").textContent = currency(vat);
  $("#reviewGrossAmount").textContent = currency(grossAmount);
  $("#reviewTotalRrp").textContent = currency(totalRrp);
}

function updateDocumentImportAction() {
  const isCredit = $("#reviewDocumentType")?.value === "Credit Note";
  $("#importInvoice").textContent = isCredit ? "Apply credit note →" : "Add to stock →";
}

function reviewLineMarkup(item) {
  return `<tr><td><input class="line-name" value="${escapeHtml(item.name)}" placeholder="Product name"></td><td><input class="line-sku" value="${escapeHtml(item.sku)}" placeholder="SKU"></td><td><input class="line-qty" type="number" min="1" value="${item.qty}"></td><td><input class="line-cost" type="number" min="0" step=".01" value="${item.cost}"></td><td><input class="line-rrp" type="number" min="0" step=".01" value="${item.rrp || 0}"></td><td><input class="line-barcode" value="${escapeHtml(item.barcode || "")}" placeholder="Barcode"></td><td><button class="remove-line" aria-label="Remove line">×</button></td></tr>`;
}

function getReviewedDocumentData() {
  const supplier = $("#reviewSupplier").value.trim() || "Unknown supplier";
  const documentType = $("#reviewDocumentType").value;
  const stockCategory = $("#reviewStockCategory").value === "supply" ? "supply" : "resale";
  const documentId = $("#reviewInvoiceNumber").value.trim() || makeId(documentType === "Credit Note" ? "CN" : "INV");
  const documentDate = $("#reviewDocumentDate").value || new Date().toISOString().slice(0, 10);
  const direction = documentType === "Credit Note" ? -1 : 1;
  const lines = $$("#reviewItems tr").map(row => ({ name:$(".line-name", row).value.trim(), sku:$(".line-sku", row).value.trim(), barcode:$(".line-barcode", row).value.trim(), qty:Number($(".line-qty", row).value), cost:Number($(".line-cost", row).value), rrp:Number($(".line-rrp", row).value) })).filter(line => line.name && line.qty > 0);
  return { supplier, documentType, stockCategory, documentId, documentDate, direction, lines };
}

async function saveReviewedDocument(applyStock) {
  const { supplier, documentType, stockCategory, documentId, documentDate, direction, lines } = getReviewedDocumentData();
  if (state.invoices.some(document => document.id.toLowerCase() === documentId.toLowerCase())) return showToast("Document already imported", `${documentId} already exists. Check the document number before continuing.`);
  if (!lines.length) return showToast("Nothing to import", "Add at least one valid document line.");
  const importButton = $("#importInvoice");
  const uploadButton = $("#uploadInvoice");
  importButton.disabled = true;
  uploadButton.disabled = true;
  const activeButton = applyStock ? importButton : uploadButton;
  activeButton.textContent = "Saving original…";
  let file = null;
  try {
    file = await window.VanitaCloud.uploadDocument(pendingDocumentFile, documentId);
  } catch (error) {
    importButton.disabled = false;
    uploadButton.disabled = false;
    uploadButton.textContent = "Upload";
    updateDocumentImportAction();
    return showToast("Document not saved", error.message || "The original file could not be stored.");
  }
  let changedUnits = 0;
  let unmatchedUnits = 0;
  if (applyStock) lines.forEach((line, index) => {
    const normalizedSku = line.sku.trim().toLowerCase();
    const normalizedName = line.name.trim().toLowerCase();
    let product = state.products.find(p =>
      (normalizedSku && String(p.sku || "").trim().toLowerCase() === normalizedSku) ||
      String(p.name || "").trim().toLowerCase() === normalizedName
    );
    if (product) {
      product.classification = stockCategory;
      if (direction === 1) {
        product.inInventory = true;
        product.stock += line.qty;
        changedUnits += line.qty;
      } else {
        const returned = Math.min(product.stock, line.qty);
        product.stock -= returned;
        changedUnits += returned;
        unmatchedUnits += line.qty - returned;
      }
      if (line.cost > 0 || !(Number(product.unitCost) > 0)) product.unitCost = line.cost;
      if (line.rrp > 0) product.salePrice = line.rrp;
      if (line.barcode) product.barcode = line.barcode;
      product.supplier = supplier;
    } else if (direction === 1) {
      state.products.push({ id:`${makeId("p")}-${index}`, name:line.name, sku:line.sku || `SKU-${String(Date.now()).slice(-6)}-${index + 1}`, brand:"", barcode:line.barcode, category:"Other", classification:stockCategory, stock:line.qty, inInventory:true, reorderAt:2, target:Math.max(6,line.qty * 2), unitCost:line.cost, salePrice:stockCategory === "resale" ? (line.rrp > 0 ? line.rrp : Number((line.cost * 1.65).toFixed(2))) : line.rrp, supplier, icon:"✦", tint:"#edf1ef" });
      changedUnits += line.qty;
    } else {
      unmatchedUnits += line.qty;
    }
  });
  const { netAmount, vat, totalRrp, vatRate, grossAmount:total } = getReviewTotals();
  const status = applyStock ? (documentType === "Credit Note" ? "Applied" : "Imported") : "Uploaded only";
  state.invoices.unshift({ id:documentId, type:documentType, stockCategory, stockApplied:applyStock, supplier, date:`${documentDate}T12:00:00`, items:lines.reduce((sum, line) => sum + line.qty, 0), lines, direction:applyStock ? direction : 0, netAmount, vatRate, vat, totalRrp, total, file, status });
  const activityVerb = applyStock ? (documentType === "Credit Note" ? "applied" : "imported") : "uploaded";
  const activityDetail = applyStock ? `${supplier} · ${changedUnits} units ${direction === 1 ? "added" : "returned"}` : `${supplier} · saved without changing stock`;
  state.activities.unshift({ type:documentType === "Credit Note" ? "credit" : "invoice", title:`${documentType} ${documentId} ${activityVerb}`, detail:activityDetail, date:new Date().toISOString() });
  saveState(); renderAll(); closeModal();
  if (!applyStock) {
    showToast("Document uploaded", `${documentId} was added to Documents without changing stock.`);
    switchView("invoices");
    return;
  }
  const note = unmatchedUnits ? ` ${unmatchedUnits} unmatched units were not deducted.` : "";
  showToast("Stock updated", `${changedUnits} units ${direction === 1 ? "added" : "returned"} from ${documentId}.${note}`);
  switchView("invoices");
}

function setupProductModal(productId = null) {
  openModal("#addProductTemplate");
  scannerPurpose = "product";
  $("#productForm").dataset.productId = productId || "";
  const product = productId ? state.products.find(item => item.id === productId) : null;
  if (product) {
    $("#modalTitle").textContent = "Edit product";
    $("#saveProductButton").textContent = "Save changes";
    const form = $("#productForm");
    ["name", "sku", "brand", "barcode", "category", "classification", "supplier", "stock", "reorderAt", "unitCost", "salePrice"].forEach(field => {
      if (form.elements[field]) form.elements[field].value = product[field] ?? "";
    });
  }
  $("#productBarcodeScan").addEventListener("click", startCameraScanner);
  $("#stopCamera").addEventListener("click", stopCamera);
  $("#productForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target));
    const values = { name:form.name.trim(), sku:form.sku.trim(), brand:form.brand.trim(), barcode:form.barcode.trim(), category:form.category, classification:form.classification === "supply" ? "supply" : "resale", supplier:form.supplier.trim(), stock:Number(form.stock), reorderAt:Number(form.reorderAt), target:Math.max(Number(form.stock), Number(form.reorderAt)*3), unitCost:Number(form.unitCost), salePrice:Number(form.salePrice) };
    const duplicateBarcode = values.barcode && state.products.find(item => item.id !== productId && barcodesMatch(item.barcode, values.barcode));
    if (duplicateBarcode) return showToast("Barcode already assigned", `${values.barcode} belongs to ${duplicateBarcode.name}.`);
    if (product) {
      Object.assign(product, values);
      if (values.stock > 0) product.inInventory = true;
      state.activities.unshift({ type:"invoice", title:`${values.name} updated`, detail:"Product catalogue details edited", date:new Date().toISOString() });
    } else {
      state.products.push({ id:makeId("p"), ...values, inInventory:true, icon:"📦", tint:"#edf1ef" });
      state.activities.unshift({ type:"invoice", title:`${values.name} added`, detail:`Opening stock: ${values.stock} units`, date:new Date().toISOString() });
    }
    saveState(); renderAll(); closeModal(); showToast(product ? "Product updated" : "Product added", product ? `${values.name}'s details have been saved.` : `${values.name} is now in inventory.`);
  });
}

function setupServiceModal(serviceId = null) {
  openModal("#addServiceTemplate");
  const service = serviceId ? state.services.find(item => item.id === serviceId) : null;
  const form = $("#serviceForm");
  if (service) {
    $("#modalTitle").textContent = "Edit service";
    $("#saveServiceButton").textContent = "Save changes";
    ["name", "code", "category", "duration", "price", "cost", "vatRate", "description"].forEach(field => {
      if (form.elements[field]) form.elements[field].value = service[field] ?? "";
    });
    form.elements.staff.value = (service.staff || []).join(", ");
    form.elements.active.checked = service.active !== false;
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const code = values.code.trim();
    const duplicate = state.services.find(item => item.id !== serviceId && String(item.code || "").trim().toLowerCase() === code.toLowerCase());
    if (duplicate) return showToast("Service code already used", `${duplicate.name} already uses ${code}.`);
    const details = {
      name:values.name.trim(),
      code,
      category:values.category,
      duration:Math.max(0, Number(values.duration) || 0),
      price:Math.max(0, Number(values.price) || 0),
      cost:Math.max(0, Number(values.cost) || 0),
      vatRate:Math.max(0, Number(values.vatRate) || 0),
      staff:String(values.staff || "").split(",").map(name => name.trim()).filter(Boolean),
      description:String(values.description || "").trim(),
      active:values.active === "on"
    };
    if (service) {
      Object.assign(service, details);
      state.activities.unshift({ type:"invoice", title:`${details.name} updated`, detail:"Service catalogue details edited", date:new Date().toISOString() });
    } else {
      state.services.push({ id:makeId("svc"), ...details });
      state.activities.unshift({ type:"invoice", title:`${details.name} added`, detail:`${details.duration} minutes · ${currency(details.price)}`, date:new Date().toISOString() });
    }
    saveState();
    renderAll();
    closeModal();
    showToast(service ? "Service updated" : "Service added", `${details.name} is ${details.active ? "available for sale" : "saved as inactive"}.`);
  });
}

function toggleService(serviceId) {
  const service = state.services.find(item => item.id === serviceId);
  if (!service) return;
  service.active = service.active === false;
  saleBasket = saleBasket.filter(line => !(line.itemType === "service" && line.itemId === serviceId && service.active === false));
  state.activities.unshift({ type:"invoice", title:`${service.name} ${service.active ? "activated" : "archived"}`, detail:service.active ? "Available for new sales" : "Hidden from new sales; history retained", date:new Date().toISOString() });
  saveState();
  renderAll();
  showToast(service.active ? "Service activated" : "Service archived", service.active ? `${service.name} can now be added to sales.` : "Historic sales remain unchanged.");
}

function deleteService(serviceId) {
  const service = state.services.find(item => item.id === serviceId);
  if (!service || !window.confirm(`Permanently delete ${service.name}?\n\nIt will be removed from the Services catalogue. Historic sales will retain their saved service name and price.`)) return;
  state.services = state.services.filter(item => item.id !== serviceId);
  saleBasket = saleBasket.filter(line => !(line.itemType === "service" && line.itemId === serviceId));
  state.activities.unshift({ type:"alert", title:`${service.name} deleted`, detail:"Removed from Services; historic sales retained", date:new Date().toISOString() });
  saveState();
  renderAll();
  showToast("Service deleted", "Historic sales were not changed.");
}

function openCatalogMenu() {
  openModal("#catalogMenuTemplate");
  $("#modal").addEventListener("click", event => {
    const choice = event.target.closest("[data-catalog-view]");
    if (!choice) return;
    closeModal();
    switchView(choice.dataset.catalogView);
  });
}

function removeFromInventory(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product || !window.confirm(`Remove ${product.name} from Inventory?\n\nIts stock quantity will be cleared, but the product and its details will remain in Products.`)) return;
  product.stock = 0;
  product.inInventory = false;
  state.activities.unshift({ type:"alert", title:`${product.name} removed from inventory`, detail:"Product record retained in Products", date:new Date().toISOString() });
  saveState();
  renderAll();
  showToast("Removed from Inventory", `${product.name} is still available in Products.`);
}

function deleteProduct(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product || !window.confirm(`Permanently delete ${product.name}?\n\nThis removes it from both Products and Inventory. This action cannot be undone.`)) return;
  state.products = state.products.filter(item => item.id !== productId);
  saleBasket = saleBasket.filter(item => !(item.itemType === "product" && item.itemId === productId));
  state.activities.unshift({ type:"alert", title:`${product.name} deleted`, detail:"Removed from Products and Inventory", date:new Date().toISOString() });
  saveState();
  renderAll();
  showToast("Product deleted", `${product.name} was removed from Products and Inventory.`);
}

function setupSaleModal(saleId = null) {
  editingSaleId = saleId;
  const existingSale = saleId ? state.sales.find(item => item.id === saleId) : null;
  if (saleId && (!existingSale || !Array.isArray(existingSale.lines) || !existingSale.lines.length)) return showToast("Sale details unavailable", "This older sale has no saved basket and cannot be edited safely.");
  saleBasket = existingSale ? existingSale.lines.map(line => ({
    itemType:saleLineType(line),
    itemId:line.itemId || line.productId || line.serviceId,
    qty:Number(line.qty) || 0,
    staff:line.staff || "",
    unitPrice:Number(line.unitPrice) || 0,
    lineDiscount:Math.max(0, Number(line.lineDiscount) || 0),
    name:line.name || "",
    duration:Number(line.duration) || 0,
    vatRate:Number(line.vatRate) || 0,
    category:line.category || "Other"
  })) : [];
  saleBasketDiscount = existingSale ? Math.max(0, Number(existingSale.basketDiscount) || 0) : 0;
  saleItemFilter = "all";
  scannerPurpose = "sale";
  openModal("#recordSaleTemplate");
  if (existingSale) {
    $("#modalTitle").textContent = `Edit sale ${existingSale.id}`;
    $("#completeSale").textContent = "Save sale changes";
  }
  const input = $("#saleProductSearch");
  input.focus(); renderSaleSuggestions(""); renderSaleBasket();
  input.addEventListener("input", () => renderSaleSuggestions(input.value));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      const typedValue = input.value.trim();
      const product = findProductByBarcode(typedValue) || sellableProducts().find(p => p.stock > 0 && String(p.sku || "").toLowerCase() === typedValue.toLowerCase());
      const service = activeServices().find(item => String(item.code || "").toLowerCase() === typedValue.toLowerCase());
      const exactType = product ? "product" : service ? "service" : "";
      const exactItem = product || service;
      if (exactItem) { addBasketItem(exactType, exactItem.id); input.value=""; renderSaleSuggestions(""); }
      else if (typedValue) showToast("Item not found", `No available product or service matches ${typedValue}.`);
    }
  });
  $("#saleSuggestions").addEventListener("click", event => {
    const item = event.target.closest("[data-sale-item-id]");
    if (item) addBasketItem(item.dataset.saleItemType, item.dataset.saleItemId);
  });
  $("#saleBasket").addEventListener("click", event => {
    const button = event.target.closest("[data-qty]");
    if (button) changeBasketQty(button.dataset.itemType, button.dataset.itemId, Number(button.dataset.qty));
  });
  $("#saleBasket").addEventListener("change", event => {
    const select = event.target.closest("[data-service-staff]");
    if (select) setBasketStaff(select.dataset.serviceStaff, select.value);
  });
  $$("[data-sale-filter]", $("#modal")).forEach(button => button.addEventListener("click", () => {
    saleItemFilter = button.dataset.saleFilter;
    $$("[data-sale-filter]", $("#modal")).forEach(item => item.classList.toggle("active", item === button));
    renderSaleSuggestions(input.value);
  }));
  $("#reviewCheckout").addEventListener("click", openSaleCheckout);
  $("#backToBasket").addEventListener("click", showSaleBuildStep);
  $("#checkoutLines").addEventListener("input", event => {
    const input = event.target.closest("[data-line-discount]");
    if (!input) return;
    const line = saleBasket[Number(input.dataset.lineDiscount)];
    if (line) line.lineDiscount = Math.max(0, Number(input.value) || 0);
    renderCheckout();
  });
  $("#basketDiscount").addEventListener("input", event => { saleBasketDiscount = Math.max(0, Number(event.target.value) || 0); renderCheckout(); });
  $("#completeSale").addEventListener("click", saveSale);
  $("#cameraScan").addEventListener("click", startCameraScanner);
  $("#stopCamera").addEventListener("click", stopCamera);
}

function renderSaleSuggestions(query) {
  const q = query.trim().toLowerCase();
  const products = saleItemFilter === "service" ? [] : sellableProducts()
    .filter(product => product.stock > 0 && (!q || [product.name, product.sku, product.barcode].some(value => String(value || "").toLowerCase().includes(q))))
    .slice(0, q ? 6 : 3)
    .map(product => ({ itemType:"product", item:product }));
  const services = saleItemFilter === "product" ? [] : activeServices()
    .filter(service => !q || [service.name, service.code, service.category].some(value => String(value || "").toLowerCase().includes(q)))
    .slice(0, q ? 6 : 3)
    .map(service => ({ itemType:"service", item:service }));
  const results = [...products, ...services].slice(0, q ? 8 : 6);
  $("#saleSuggestions").innerHTML = results.length ? results.map(({ itemType, item }) => {
    const isProduct = itemType === "product";
    const detail = isProduct ? `${item.sku || "No SKU"} · ${item.stock} in stock` : `${item.code || "No code"} · ${item.duration || 0} min · ${currency(Number(item.price) || 0)}`;
    return `<button class="sale-suggestion" data-sale-item-type="${itemType}" data-sale-item-id="${item.id}"><span class="product-thumb ${isProduct ? "" : "service-thumb"}" style="--thumb:${isProduct ? item.tint : "#f0edf8"}">${isProduct ? item.icon : "✦"}</span><span><strong>${escapeHtml(item.name)} <em class="item-type-badge ${itemType}">${isProduct ? "Product" : "Service"}</em></strong><small>${escapeHtml(detail)}</small></span><span>＋ Add</span></button>`;
  }).join("") : `<div class="suggestion-empty">No available ${saleItemFilter === "all" ? "products or services" : `${saleItemFilter}s`} found.</div>`;
}

function addToBasket(productId) {
  addBasketItem("product", productId);
}

function getSaleItem(itemType, itemId) {
  return itemType === "service" ? state.services.find(item => item.id === itemId) : state.products.find(item => item.id === itemId);
}

function getBasketItem(line) {
  return getSaleItem(line.itemType, line.itemId) || { id:line.itemId, name:line.name || "Unavailable catalogue item", salePrice:line.unitPrice, price:line.unitPrice, duration:line.duration, vatRate:line.vatRate, category:line.category, staff:[], stock:0, icon:"◇", tint:"#edf1ef" };
}

function originalSaleProductQty(productId) {
  const sale = editingSaleId ? state.sales.find(item => item.id === editingSaleId) : null;
  return (sale?.lines || []).filter(line => saleLineType(line) === "product" && (line.productId || line.itemId) === productId).reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
}

function availableProductQty(productId) {
  const product = state.products.find(item => item.id === productId);
  return Math.max(0, Number(product?.stock) || 0) + originalSaleProductQty(productId);
}

function addBasketItem(itemType, itemId) {
  const item = getSaleItem(itemType, itemId);
  if (!item || (itemType === "product" && (!isResaleProduct(item) || availableProductQty(itemId) <= 0)) || (itemType === "service" && item.active === false)) return;
  const line = saleBasket.find(entry => entry.itemType === itemType && entry.itemId === itemId);
  if (line) {
    if (itemType === "service" || line.qty < availableProductQty(itemId)) line.qty++;
  } else {
    saleBasket.push({ itemType, itemId, qty:1, staff:"", lineDiscount:0, unitPrice:Number(itemType === "product" ? item.salePrice : item.price) || 0, name:item.name || "", duration:Number(item.duration) || 0, vatRate:Number(item.vatRate) || 0, category:item.category || "Other" });
  }
  renderSaleBasket();
}

function changeBasketQty(itemType, itemId, delta) {
  const line = saleBasket.find(entry => entry.itemType === itemType && entry.itemId === itemId);
  const item = getSaleItem(itemType, itemId);
  if (!line || !item) return;
  const maximum = itemType === "product" ? availableProductQty(itemId) : 99;
  line.qty = Math.min(maximum, line.qty + delta);
  if (line.qty <= 0) saleBasket = saleBasket.filter(entry => entry !== line);
  renderSaleBasket();
}

function setBasketStaff(serviceId, staff) {
  const line = saleBasket.find(entry => entry.itemType === "service" && entry.itemId === serviceId);
  if (line) line.staff = staff;
}

function renderSaleBasket() {
  const basket = $("#saleBasket");
  if (!basket) return;
  basket.innerHTML = saleBasket.length ? saleBasket.map(line => {
    const item = getBasketItem(line);
    const isProduct = line.itemType === "product";
    const unitPrice = Number(line.unitPrice) || Number(isProduct ? item.salePrice : item.price) || 0;
    const detail = isProduct ? `${currency(unitPrice)} each · ${availableProductQty(item.id)} available` : `${currency(unitPrice)} · ${item.duration || line.duration || 0} minutes`;
    const staffOptions = !isProduct && (item.staff || []).length
      ? `<label class="basket-staff">Staff<select data-service-staff="${item.id}"><option value="">Not assigned</option>${item.staff.map(name => `<option value="${escapeHtml(name)}" ${line.staff === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>`
      : !isProduct ? `<span class="basket-staff-empty">Staff not assigned</span>` : "";
    return `<div class="basket-item ${line.itemType}"><div><strong>${escapeHtml(item.name)} <em class="item-type-badge ${line.itemType}">${isProduct ? "Product" : "Service"}</em></strong><small>${detail}</small>${staffOptions}</div><div class="qty-control"><button data-item-type="${line.itemType}" data-item-id="${item.id}" data-qty="-1">−</button><span>${line.qty}</span><button data-item-type="${line.itemType}" data-item-id="${item.id}" data-qty="1">＋</button></div><span class="basket-price">${currency(line.qty * unitPrice)}</span></div>`;
  }).join("") : `<div class="basket-empty"><span>↗</span><p>Search for a product or service to begin</p></div>`;
  const total = saleBasket.reduce((sum, line) => {
    const item = getBasketItem(line);
    return sum + line.qty * (Number(line.unitPrice) || Number(line.itemType === "product" ? item?.salePrice : item?.price) || 0);
  }, 0);
  $("#saleTotal").textContent = currency(total);
  $("#reviewCheckout").disabled = !saleBasket.length;
}

function showSaleBuildStep() {
  $("#saleBuildStep").hidden = false;
  $("#saleBuildFooter").hidden = false;
  $("#saleCheckoutStep").hidden = true;
  $("#saleCheckoutFooter").hidden = true;
}

function openSaleCheckout() {
  if (!saleBasket.length) return;
  stopCamera();
  $("#saleBuildStep").hidden = true;
  $("#saleBuildFooter").hidden = true;
  $("#saleCheckoutStep").hidden = false;
  $("#saleCheckoutFooter").hidden = false;
  $("#basketDiscount").value = saleBasketDiscount.toFixed(2);
  renderCheckout();
}

function getCheckoutTotals() {
  const lineTotals = saleBasket.map(line => {
    const item = getBasketItem(line);
    const unitPrice = Math.max(0, Number(line.unitPrice) || Number(line.itemType === "product" ? item.salePrice : item.price) || 0);
    const gross = Math.max(0, (Number(line.qty) || 0) * unitPrice);
    const discount = Math.min(gross, Math.max(0, Number(line.lineDiscount) || 0));
    return { line, item, unitPrice, gross, discount, net:gross - discount };
  });
  const subtotal = lineTotals.reduce((sum, row) => sum + row.gross, 0);
  const lineDiscountTotal = lineTotals.reduce((sum, row) => sum + row.discount, 0);
  const afterLineDiscounts = subtotal - lineDiscountTotal;
  const basketDiscount = Math.min(afterLineDiscounts, Math.max(0, Number(saleBasketDiscount) || 0));
  const total = Math.max(0, afterLineDiscounts - basketDiscount);
  return { lineTotals, subtotal, lineDiscountTotal, afterLineDiscounts, basketDiscount, discountTotal:lineDiscountTotal + basketDiscount, total };
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
