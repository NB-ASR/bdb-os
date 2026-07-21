(function () {
  function installContactsModule() {
    if (
      typeof state === "undefined" ||
      typeof renderAll !== "function" ||
      typeof normalizeState !== "function" ||
      typeof switchView !== "function" ||
      typeof openModal !== "function" ||
      typeof saveState !== "function" ||
      typeof setupSaleModal !== "function" ||
      typeof setupProductModal !== "function" ||
      typeof showInvoiceReview !== "function" ||
      !document.querySelector(".main-nav")
    ) {
      setTimeout(installContactsModule, 25);
      return;
    }
    if (window.__vanitaContactsInstalled) return;
    window.__vanitaContactsInstalled = true;

    const originalNormalizeState = normalizeState;
    const originalRenderAll = renderAll;
    const originalRenderSales = renderSales;
    const originalSetupSaleModal = setupSaleModal;
    const originalSetupProductModal = setupProductModal;
    const originalShowInvoiceReview = showInvoiceReview;
    const originalOpenCatalogMenu = typeof openCatalogMenu === "function" ? openCatalogMenu : null;

    const normaliseText = value => String(value || "").trim().toLowerCase();
    const slug = value => String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const recordId = (prefix, name) => `${prefix}-${slug(name) || String(Date.now()).slice(-8)}`;
    const formatDate = value => value ? new Date(value).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : "—";

    function ensureContactState(data) {
      if (!data || typeof data !== "object") return data;
      if (!Array.isArray(data.suppliers)) data.suppliers = [];
      if (!Array.isArray(data.clients)) data.clients = [];

      data.suppliers = data.suppliers.map(supplier => ({
        id:supplier.id || recordId("sup", supplier.name),
        name:String(supplier.name || "").trim(),
        contactName:String(supplier.contactName || "").trim(),
        email:String(supplier.email || "").trim(),
        phone:String(supplier.phone || "").trim(),
        vatNumber:String(supplier.vatNumber || "").trim(),
        address:String(supplier.address || "").trim(),
        notes:String(supplier.notes || "").trim(),
        active:supplier.active !== false
      })).filter(supplier => supplier.name);

      const supplierNames = [...new Set([
        ...(data.products || []).map(product => product.supplier),
        ...(data.invoices || []).map(document => document.supplier)
      ].map(name => String(name || "").trim()).filter(Boolean))];
      supplierNames.forEach(name => {
        if (!data.suppliers.some(supplier => normaliseText(supplier.name) === normaliseText(name))) {
          data.suppliers.push({ id:recordId("sup", name), name, contactName:"", email:"", phone:"", vatNumber:"", address:"", notes:"", active:true });
        }
      });

      data.clients = data.clients.map(client => ({
        id:client.id || recordId("cli", client.name),
        name:String(client.name || "").trim(),
        email:String(client.email || "").trim(),
        phone:String(client.phone || "").trim(),
        preferredServices:String(client.preferredServices || "").trim(),
        notes:String(client.notes || "").trim(),
        active:client.active !== false,
        createdAt:client.createdAt || new Date().toISOString()
      })).filter(client => client.name);

      (data.sales || []).forEach(sale => {
        if (!sale.clientId && sale.clientName) {
          let client = data.clients.find(item => normaliseText(item.name) === normaliseText(sale.clientName));
          if (!client) {
            client = { id:recordId("cli", sale.clientName), name:String(sale.clientName).trim(), email:"", phone:"", preferredServices:"", notes:"", active:true, createdAt:sale.date || new Date().toISOString() };
            data.clients.push(client);
          }
          sale.clientId = client.id;
        }
      });
      return data;
    }

    normalizeState = function (data) {
      return ensureContactState(originalNormalizeState(data));
    };
    ensureContactState(state);

    function injectInterface() {
      if (!$("#suppliersView")) {
        const servicesNav = $('.main-nav [data-view="services"]');
        servicesNav.insertAdjacentHTML("afterend", `
          <button class="nav-item" data-view="suppliers"><span class="nav-icon">♢</span><span>Suppliers</span></button>
          <button class="nav-item" data-view="clients"><span class="nav-icon">◎</span><span>Clients</span></button>
        `);

        $("#invoicesView").insertAdjacentHTML("beforebegin", `
          <section class="view" id="suppliersView">
            <div class="page-heading">
              <div><p class="eyebrow">SUPPLIER DIRECTORY</p><h1>Suppliers</h1><p>Maintain supplier contacts and review the products, documents and spend connected to each supplier.</p></div>
              <button class="primary-button" data-action="add-supplier">＋ Add supplier</button>
            </div>
            <div class="invoice-summary" id="supplierSummary"></div>
            <div class="toolbar panel"><label class="table-search"><span>⌕</span><input id="supplierSearch" placeholder="Search supplier, contact, email or phone" /></label><span class="result-count" id="supplierResultCount"></span></div>
            <div class="panel table-panel"><div class="table-wrap"><table class="contacts-table"><thead><tr><th>Supplier</th><th>Contact</th><th>Products</th><th>Documents</th><th>Net spend</th><th>Last document</th><th>Status</th><th></th></tr></thead><tbody id="supplierTable"></tbody></table></div><div class="empty-state" id="supplierEmpty"><span>♢</span><h3>No suppliers found</h3><p>Add a supplier or change your search.</p></div></div>
          </section>
          <section class="view" id="clientsView">
            <div class="page-heading">
              <div><p class="eyebrow">CLIENT DIRECTORY</p><h1>Clients</h1><p>Keep contact details and connect each client to their recorded sales and service history.</p></div>
              <button class="primary-button" data-action="add-client">＋ Add client</button>
            </div>
            <div class="invoice-summary" id="clientSummary"></div>
            <div class="toolbar panel"><label class="table-search"><span>⌕</span><input id="clientSearch" placeholder="Search client, email, phone or preference" /></label><span class="result-count" id="clientResultCount"></span></div>
            <div class="panel table-panel"><div class="table-wrap"><table class="contacts-table"><thead><tr><th>Client</th><th>Contact</th><th>Preferred services</th><th>Visits</th><th>Total spend</th><th>Last visit</th><th>Status</th><th></th></tr></thead><tbody id="clientTable"></tbody></table></div><div class="empty-state" id="clientEmpty"><span>◎</span><h3>No clients found</h3><p>Add a client or change your search.</p></div></div>
          </section>
        `);

        document.body.insertAdjacentHTML("beforeend", `
          <template id="supplierTemplate">
            <div class="modal-header"><div><p class="eyebrow">SUPPLIER DETAILS</p><h2 id="modalTitle">Add supplier</h2></div><button class="icon-button" data-close-modal>×</button></div>
            <form id="supplierForm"><div class="modal-body form-grid contact-form">
              <label class="wide">Supplier name<input name="name" required placeholder="e.g. Collis Williams Ltd" /></label>
              <label>Contact person<input name="contactName" placeholder="Primary contact" /></label><label>VAT number<input name="vatNumber" placeholder="Optional VAT number" /></label>
              <label>Email<input name="email" type="email" placeholder="orders@supplier.com" /></label><label>Phone<input name="phone" type="tel" placeholder="Contact number" /></label>
              <label class="wide">Address<textarea name="address" rows="2" placeholder="Supplier address"></textarea></label>
              <label class="wide">Notes<textarea name="notes" rows="3" placeholder="Ordering terms, delivery days or account notes"></textarea></label>
              <label class="toggle-field"><input name="active" type="checkbox" checked /> Active supplier</label>
            </div><div class="modal-footer"><button type="button" class="secondary-button" data-close-modal>Cancel</button><button class="primary-button" type="submit" id="saveSupplierButton">Add supplier</button></div></form>
          </template>
          <template id="clientTemplate">
            <div class="modal-header"><div><p class="eyebrow">CLIENT DETAILS</p><h2 id="modalTitle">Add client</h2></div><button class="icon-button" data-close-modal>×</button></div>
            <form id="clientForm"><div class="modal-body form-grid contact-form">
              <label class="wide">Client name<input name="name" required placeholder="Full name" /></label>
              <label>Email<input name="email" type="email" placeholder="client@email.com" /></label><label>Phone<input name="phone" type="tel" placeholder="Contact number" /></label>
              <label class="wide">Preferred services<input name="preferredServices" placeholder="e.g. Facials, massage, nail treatments" /></label>
              <label class="wide">Notes<textarea name="notes" rows="3" placeholder="General preferences or follow-up notes"></textarea></label>
              <label class="toggle-field"><input name="active" type="checkbox" checked /> Active client</label>
            </div><div class="modal-footer"><button type="button" class="secondary-button" data-close-modal>Cancel</button><button class="primary-button" type="submit" id="saveClientButton">Add client</button></div></form>
          </template>
        `);
      }

      if (!$("#contactsStyles")) {
        const style = document.createElement("style");
        style.id = "contactsStyles";
        style.textContent = `
          .contacts-table td { vertical-align: middle; }
          .contact-primary { display:flex; flex-direction:column; gap:3px; min-width:170px; }
          .contact-primary strong { color:#1b342d; }
          .contact-primary small, .contact-detail { color:#73827d; }
          .contact-detail { display:flex; flex-direction:column; gap:3px; min-width:150px; }
          .contact-actions { display:flex; align-items:center; gap:6px; justify-content:flex-end; }
          .contact-notes { max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .sale-client-field { display:flex; flex-direction:column; gap:7px; margin:0 0 18px; font-weight:600; color:#344b44; }
          .sale-client-field select { width:100%; padding:12px 14px; border:1px solid #d8e1dd; border-radius:10px; background:#fff; font:inherit; color:#243b34; }
          .catalog-choices button[data-catalog-view="suppliers"] span, .catalog-choices button[data-catalog-view="clients"] span { background:#edf3f0; color:#365f53; }
          @media (max-width: 720px) {
            .contacts-table { min-width:920px; }
            .contact-form { grid-template-columns:1fr; }
            .contact-form .wide { grid-column:auto; }
          }
        `;
        document.head.append(style);
      }
    }

    const supplierProducts = supplier => state.products.filter(product => normaliseText(product.supplier) === normaliseText(supplier.name));
    const supplierDocuments = supplier => state.invoices.filter(document => normaliseText(document.supplier) === normaliseText(supplier.name));
    const supplierSpend = supplier => supplierDocuments(supplier).reduce((sum, document) => {
      const value = Math.max(0, Number(document.actualPaidTotal ?? document.total) || 0);
      return sum + ((document.type || "Invoice") === "Credit Note" ? -value : value);
    }, 0);
    const clientSales = client => state.sales.filter(sale => sale.clientId === client.id || (!sale.clientId && normaliseText(sale.clientName) === normaliseText(client.name)));

    function renderSuppliers() {
      const summary = $("#supplierSummary");
      if (!summary) return;
      ensureContactState(state);
      const active = state.suppliers.filter(supplier => supplier.active !== false);
      const totalSpend = state.suppliers.reduce((sum, supplier) => sum + supplierSpend(supplier), 0);
      const linkedProducts = state.products.filter(product => String(product.supplier || "").trim()).length;
      summary.innerHTML = [
        ["♢", state.suppliers.length, "Suppliers"],
        ["✓", active.length, "Active suppliers"],
        ["□", linkedProducts, "Products assigned"],
        ["€", currency(totalSpend), "Net supplier spend"]
      ].map(([icon, value, label]) => `<div class="invoice-stat"><span>${icon}</span><div><strong>${escapeHtml(value)}</strong><small>${label}</small></div></div>`).join("");

      const query = normaliseText($("#supplierSearch")?.value);
      const filtered = state.suppliers.filter(supplier => [supplier.name, supplier.contactName, supplier.email, supplier.phone, supplier.vatNumber].some(value => normaliseText(value).includes(query))).sort((a, b) => a.name.localeCompare(b.name));
      $("#supplierResultCount").textContent = `${filtered.length} supplier${filtered.length === 1 ? "" : "s"}`;
      $("#supplierTable").innerHTML = filtered.map(supplier => {
        const products = supplierProducts(supplier);
        const documents = supplierDocuments(supplier);
        const latest = documents.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        return `<tr>
          <td><div class="contact-primary"><strong>${escapeHtml(supplier.name)}</strong><small>${escapeHtml(supplier.vatNumber || supplier.address || "No VAT/address saved")}</small></div></td>
          <td><div class="contact-detail"><span>${escapeHtml(supplier.contactName || "No contact person")}</span><small>${escapeHtml(supplier.email || supplier.phone || "No contact details")}</small></div></td>
          <td>${products.length}</td><td>${documents.length}</td><td><strong>${currency(supplierSpend(supplier))}</strong></td><td>${latest ? formatDate(latest.date) : "—"}</td>
          <td><span class="status-badge ${supplier.active !== false ? "good" : "neutral"}">${supplier.active !== false ? "Active" : "Archived"}</span></td>
          <td><div class="contact-actions"><button class="document-action-button" data-edit-supplier="${escapeHtml(supplier.id)}">Edit</button><button class="document-action-button" data-toggle-supplier="${escapeHtml(supplier.id)}">${supplier.active !== false ? "Archive" : "Activate"}</button><button class="delete-record-button" data-delete-supplier="${escapeHtml(supplier.id)}">Delete</button></div></td>
        </tr>`;
      }).join("");
      $("#supplierEmpty").hidden = filtered.length > 0;
    }

    function renderClients() {
      const summary = $("#clientSummary");
      if (!summary) return;
      ensureContactState(state);
      const active = state.clients.filter(client => client.active !== false);
      const assignedSales = state.sales.filter(sale => sale.clientId || sale.clientName);
      const assignedRevenue = assignedSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
      summary.innerHTML = [
        ["◎", state.clients.length, "Clients"],
        ["✓", active.length, "Active clients"],
        ["↗", assignedSales.length, "Client-linked sales"],
        ["€", currency(assignedRevenue), "Client-linked revenue"]
      ].map(([icon, value, label]) => `<div class="invoice-stat"><span>${icon}</span><div><strong>${escapeHtml(value)}</strong><small>${label}</small></div></div>`).join("");

      const query = normaliseText($("#clientSearch")?.value);
      const filtered = state.clients.filter(client => [client.name, client.email, client.phone, client.preferredServices, client.notes].some(value => normaliseText(value).includes(query))).sort((a, b) => a.name.localeCompare(b.name));
      $("#clientResultCount").textContent = `${filtered.length} client${filtered.length === 1 ? "" : "s"}`;
      $("#clientTable").innerHTML = filtered.map(client => {
        const sales = clientSales(client);
        const spend = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
        const latest = sales.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        return `<tr>
          <td><div class="contact-primary"><strong>${escapeHtml(client.name)}</strong><small class="contact-notes">${escapeHtml(client.notes || "No notes")}</small></div></td>
          <td><div class="contact-detail"><span>${escapeHtml(client.phone || "No phone")}</span><small>${escapeHtml(client.email || "No email")}</small></div></td>
          <td><span class="contact-notes" title="${escapeHtml(client.preferredServices)}">${escapeHtml(client.preferredServices || "—")}</span></td>
          <td>${sales.length}</td><td><strong>${currency(spend)}</strong></td><td>${latest ? formatDate(latest.date) : "—"}</td>
          <td><span class="status-badge ${client.active !== false ? "good" : "neutral"}">${client.active !== false ? "Active" : "Archived"}</span></td>
          <td><div class="contact-actions"><button class="document-action-button" data-edit-client="${escapeHtml(client.id)}">Edit</button><button class="document-action-button" data-toggle-client="${escapeHtml(client.id)}">${client.active !== false ? "Archive" : "Activate"}</button><button class="delete-record-button" data-delete-client="${escapeHtml(client.id)}">Delete</button></div></td>
        </tr>`;
      }).join("");
      $("#clientEmpty").hidden = filtered.length > 0;
    }

    function openSupplierModal(supplierId = null) {
      const supplier = supplierId ? state.suppliers.find(item => item.id === supplierId) : null;
      openModal("#supplierTemplate");
      $("#modalTitle").textContent = supplier ? "Edit supplier" : "Add supplier";
      $("#saveSupplierButton").textContent = supplier ? "Save changes" : "Add supplier";
      const form = $("#supplierForm");
      if (supplier) {
        ["name", "contactName", "email", "phone", "vatNumber", "address", "notes"].forEach(field => { form.elements[field].value = supplier[field] || ""; });
        form.elements.active.checked = supplier.active !== false;
      }
      form.addEventListener("submit", event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const name = String(values.name || "").trim();
        if (!name) return;
        const duplicate = state.suppliers.find(item => normaliseText(item.name) === normaliseText(name) && item.id !== supplierId);
        if (duplicate) return showToast("Supplier already exists", `${name} is already in the supplier directory.`);
        const next = { id:supplier?.id || recordId("sup", name), name, contactName:String(values.contactName || "").trim(), email:String(values.email || "").trim(), phone:String(values.phone || "").trim(), vatNumber:String(values.vatNumber || "").trim(), address:String(values.address || "").trim(), notes:String(values.notes || "").trim(), active:form.elements.active.checked };
        if (supplier) {
          const oldName = supplier.name;
          Object.assign(supplier, next);
          if (normaliseText(oldName) !== normaliseText(name)) {
            state.products.forEach(product => { if (normaliseText(product.supplier) === normaliseText(oldName)) product.supplier = name; });
            state.invoices.forEach(document => { if (normaliseText(document.supplier) === normaliseText(oldName)) document.supplier = name; });
          }
        } else state.suppliers.push(next);
        saveState(); renderAll(); closeModal(); showToast(supplier ? "Supplier updated" : "Supplier added", `${name} is saved in the supplier directory.`);
      });
    }

    function openClientModal(clientId = null) {
      const client = clientId ? state.clients.find(item => item.id === clientId) : null;
      openModal("#clientTemplate");
      $("#modalTitle").textContent = client ? "Edit client" : "Add client";
      $("#saveClientButton").textContent = client ? "Save changes" : "Add client";
      const form = $("#clientForm");
      if (client) {
        ["name", "email", "phone", "preferredServices", "notes"].forEach(field => { form.elements[field].value = client[field] || ""; });
        form.elements.active.checked = client.active !== false;
      }
      form.addEventListener("submit", event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const name = String(values.name || "").trim();
        if (!name) return;
        const duplicate = state.clients.find(item => normaliseText(item.name) === normaliseText(name) && item.id !== clientId);
        if (duplicate) return showToast("Client already exists", `${name} is already in the client directory.`);
        const next = { id:client?.id || recordId("cli", name), name, email:String(values.email || "").trim(), phone:String(values.phone || "").trim(), preferredServices:String(values.preferredServices || "").trim(), notes:String(values.notes || "").trim(), active:form.elements.active.checked, createdAt:client?.createdAt || new Date().toISOString() };
        if (client) {
          const oldName = client.name;
          Object.assign(client, next);
          state.sales.forEach(sale => { if (sale.clientId === client.id || (!sale.clientId && normaliseText(sale.clientName) === normaliseText(oldName))) { sale.clientId = client.id; sale.clientName = name; } });
        } else state.clients.push(next);
        saveState(); renderAll(); closeModal(); showToast(client ? "Client updated" : "Client added", `${name} is saved in the client directory.`);
      });
    }

    function toggleSupplier(id) {
      const supplier = state.suppliers.find(item => item.id === id);
      if (!supplier) return;
      supplier.active = supplier.active === false;
      saveState(); renderAll();
    }
    function toggleClient(id) {
      const client = state.clients.find(item => item.id === id);
      if (!client) return;
      client.active = client.active === false;
      saveState(); renderAll();
    }
    function deleteSupplier(id) {
      const supplier = state.suppliers.find(item => item.id === id);
      if (!supplier) return;
      const products = supplierProducts(supplier).length;
      const documents = supplierDocuments(supplier).length;
      if (products || documents) return showToast("Supplier cannot be deleted", `${supplier.name} is linked to ${products} product${products === 1 ? "" : "s"} and ${documents} document${documents === 1 ? "" : "s"}. Archive it instead.`);
      if (!window.confirm(`Delete supplier ${supplier.name}?`)) return;
      state.suppliers = state.suppliers.filter(item => item.id !== id);
      saveState(); renderAll(); showToast("Supplier deleted", `${supplier.name} was removed.`);
    }
    function deleteClient(id) {
      const client = state.clients.find(item => item.id === id);
      if (!client) return;
      const sales = clientSales(client).length;
      if (sales) return showToast("Client cannot be deleted", `${client.name} is linked to ${sales} sale${sales === 1 ? "" : "s"}. Archive the client instead.`);
      if (!window.confirm(`Delete client ${client.name}?`)) return;
      state.clients = state.clients.filter(item => item.id !== id);
      saveState(); renderAll(); showToast("Client deleted", `${client.name} was removed.`);
    }

    function enhanceSupplierField(input) {
      if (!input || input.dataset.supplierDirectory === "true") return;
      input.dataset.supplierDirectory = "true";
      const listId = `supplierOptions-${String(Date.now()).slice(-6)}`;
      const list = document.createElement("datalist");
      list.id = listId;
      list.innerHTML = state.suppliers.filter(supplier => supplier.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(supplier => `<option value="${escapeHtml(supplier.name)}"></option>`).join("");
      document.body.append(list);
      input.setAttribute("list", listId);
    }

    setupProductModal = function (productId = null) {
      originalSetupProductModal(productId);
      enhanceSupplierField($("#productForm")?.elements?.supplier);
    };

    showInvoiceReview = function (file, extracted = {}) {
      originalShowInvoiceReview(file, extracted);
      enhanceSupplierField($("#reviewSupplier"));
    };

    setupSaleModal = function (saleId = null) {
      originalSetupSaleModal(saleId);
      const finder = $("#saleBuildStep .sale-finder");
      if (!finder || $("#saleClient")) return;
      const sale = saleId ? state.sales.find(item => item.id === saleId) : null;
      const field = document.createElement("label");
      field.className = "sale-client-field";
      field.innerHTML = `<span>Client (optional)</span><select id="saleClient"><option value="">Walk-in / not assigned</option>${state.clients.filter(client => client.active !== false || client.id === sale?.clientId).sort((a, b) => a.name.localeCompare(b.name)).map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join("")}</select>`;
      finder.insertAdjacentElement("afterend", field);
      $("#saleClient").value = sale?.clientId || "";
      const completeButton = $("#completeSale");
      if (completeButton) completeButton.addEventListener("click", () => {
        const selectedId = $("#saleClient")?.value || "";
        const targetSaleId = saleId;
        const existingSaleIds = new Set(state.sales.map(item => item.id));
        setTimeout(() => {
          const savedSale = targetSaleId
            ? state.sales.find(item => item.id === targetSaleId)
            : state.sales.find(item => !existingSaleIds.has(item.id));
          if (!savedSale) return;
          const client = state.clients.find(item => item.id === selectedId);
          if (client) { savedSale.clientId = client.id; savedSale.clientName = client.name; }
          else { delete savedSale.clientId; delete savedSale.clientName; }
          saveState(); renderAll();
        }, 0);
      }, true);
    };

    renderSales = function () {
      originalRenderSales();
      $$("#salesList .activity-item").forEach((row, index) => {
        const sale = state.sales[index];
        if (!sale) return;
        const client = state.clients.find(item => item.id === sale.clientId);
        const name = client?.name || sale.clientName;
        if (!name) return;
        const detail = $("p", row);
        if (detail && !detail.textContent.includes("Client:")) detail.textContent += ` · Client: ${name}`;
      });
    };

    renderAll = function () {
      ensureContactState(state);
      originalRenderAll();
      renderSuppliers();
      renderClients();
    };

    if (originalOpenCatalogMenu) {
      openCatalogMenu = function () {
        originalOpenCatalogMenu();
        const title = $("#modalTitle");
        if (title) title.textContent = "Catalogue & contacts";
        const choices = $(".catalog-choices", $("#modal"));
        if (!choices || choices.querySelector('[data-catalog-view="suppliers"]')) return;
        choices.insertAdjacentHTML("beforeend", `
          <button data-catalog-view="suppliers"><span>♢</span><strong>Suppliers</strong><small>Contacts, linked products and supplier spend.</small></button>
          <button data-catalog-view="clients"><span>◎</span><strong>Clients</strong><small>Contact details, visits and sales history.</small></button>
        `);
        $$('[data-catalog-view="suppliers"], [data-catalog-view="clients"]', choices).forEach(button => button.addEventListener("click", () => { closeModal(); switchView(button.dataset.catalogView); }));
      };
    }

    injectInterface();

    $$('[data-view="suppliers"], [data-view="clients"]').forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
    $$('[data-action="add-supplier"]').forEach(button => button.addEventListener("click", () => openSupplierModal()));
    $$('[data-action="add-client"]').forEach(button => button.addEventListener("click", () => openClientModal()));
    $("#supplierSearch").addEventListener("input", renderSuppliers);
    $("#clientSearch").addEventListener("input", renderClients);
    $("#supplierTable").addEventListener("click", event => {
      const edit = event.target.closest("[data-edit-supplier]");
      const toggle = event.target.closest("[data-toggle-supplier]");
      const remove = event.target.closest("[data-delete-supplier]");
      if (edit) openSupplierModal(edit.dataset.editSupplier);
      if (toggle) toggleSupplier(toggle.dataset.toggleSupplier);
      if (remove) deleteSupplier(remove.dataset.deleteSupplier);
    });
    $("#clientTable").addEventListener("click", event => {
      const edit = event.target.closest("[data-edit-client]");
      const toggle = event.target.closest("[data-toggle-client]");
      const remove = event.target.closest("[data-delete-client]");
      if (edit) openClientModal(edit.dataset.editClient);
      if (toggle) toggleClient(toggle.dataset.toggleClient);
      if (remove) deleteClient(remove.dataset.deleteClient);
    });

    $("#globalSearch").addEventListener("input", event => {
      const query = normaliseText(event.target.value);
      if (!query) return;
      const clientMatch = state.clients.some(client => [client.name, client.email, client.phone, client.preferredServices].some(value => normaliseText(value).includes(query)));
      const supplierMatch = state.suppliers.some(supplier => [supplier.name, supplier.contactName, supplier.email, supplier.phone].some(value => normaliseText(value).includes(query)));
      if (!clientMatch && !supplierMatch) return;
      event.stopImmediatePropagation();
      if (clientMatch) { switchView("clients"); $("#clientSearch").value = event.target.value; renderClients(); }
      else { switchView("suppliers"); $("#supplierSearch").value = event.target.value; renderSuppliers(); }
    }, true);

    renderAll();
  }

  installContactsModule();
})();
