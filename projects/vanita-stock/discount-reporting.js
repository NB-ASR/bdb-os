(function () {
  function installDiscountReporting() {
    if (typeof showInvoiceReview !== "function" || typeof saveReviewedDocument !== "function" || typeof renderInvoices !== "function") {
      setTimeout(installDiscountReporting, 25);
      return;
    }

    const originalShowInvoiceReview = showInvoiceReview;
    const originalRenderInvoices = renderInvoices;

    function documentCatalogueNet(document) {
      const explicit = Number(document?.catalogueNetAmount);
      if (Number.isFinite(explicit)) return Math.max(0, explicit);
      const legacy = Number(document?.netAmount);
      if (Number.isFinite(legacy)) return Math.max(0, legacy);
      return 0;
    }

    function documentDiscount(document) {
      return Math.max(0, Number(document?.supplierDiscount) || 0);
    }

    function documentPaidNet(document) {
      const explicit = Number(document?.paidNetAmount);
      return Number.isFinite(explicit) ? Math.max(0, explicit) : Math.max(0, documentCatalogueNet(document) - documentDiscount(document));
    }

    function documentPaidTotal(document) {
      const explicit = Number(document?.actualPaidTotal);
      if (Number.isFinite(explicit)) return Math.max(0, explicit);
      return Math.max(0, Number(document?.total) || 0);
    }

    state.invoices.forEach(document => {
      document.catalogueNetAmount = documentCatalogueNet(document);
      document.supplierDiscount = documentDiscount(document);
      document.paidNetAmount = documentPaidNet(document);
      document.actualPaidTotal = documentPaidTotal(document);
    });

    showInvoiceReview = function (file, extracted = {}) {
      originalShowInvoiceReview(file, extracted);
      const totals = $("#reviewTotals");
      if (!totals || $("#reviewSupplierDiscount")) return;

      const printedSubtotal = Math.max(0, Number(extracted.subtotal_before_discount) || 0);
      const printedPaidNet = Math.max(0, Number(extracted.net_after_discount) || 0);
      const extractedDiscount = Math.max(0, Number(extracted.discount_amount) || (printedSubtotal && printedPaidNet ? printedSubtotal - printedPaidNet : 0));
      const extractedVatRate = Math.max(0, Number(extracted.vat_rate) || 18);

      const discountField = document.createElement("label");
      discountField.className = "supplier-discount-field";
      discountField.innerHTML = `<small>Supplier discount</small><input id="reviewSupplierDiscount" type="number" min="0" step="0.01" value="${extractedDiscount.toFixed(2)}" />`;

      const paidNetField = document.createElement("span");
      paidNetField.innerHTML = `<small>Paid net cost</small><strong id="reviewPaidNetAmount">€0.00</strong>`;

      totals.insertBefore(discountField, $("#reviewVatRate")?.parentElement || null);
      totals.insertBefore(paidNetField, $("#reviewVatRate")?.parentElement || null);
      $("#reviewVatRate").value = extractedVatRate.toFixed(2);
      $("#reviewNetAmount")?.previousElementSibling && ($("#reviewNetAmount").previousElementSibling.textContent = "Stock cost before discount");
      $("#reviewGrossAmount")?.previousElementSibling && ($("#reviewGrossAmount").previousElementSibling.textContent = "Actual paid total");
      $("#reviewSupplierDiscount").addEventListener("input", updateReviewTotals);
      updateReviewTotals();
    };

    getReviewTotals = function () {
      const rows = $$("#reviewItems tr").map(row => ({
        name:$(".line-name", row)?.value.trim() || "",
        quantity:Math.max(0, Number($(".line-qty", row)?.value) || 0),
        unitCost:Math.max(0, Number($(".line-cost", row)?.value) || 0),
        rrp:Math.max(0, Number($(".line-rrp", row)?.value) || 0)
      })).filter(line => line.name && line.quantity > 0);
      const totalQuantity = rows.reduce((sum, line) => sum + line.quantity, 0);
      const catalogueNetAmount = rows.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
      const totalRrp = rows.reduce((sum, line) => sum + line.quantity * line.rrp, 0);
      const supplierDiscount = Math.min(catalogueNetAmount, Math.max(0, Number($("#reviewSupplierDiscount")?.value) || 0));
      const paidNetAmount = Math.max(0, catalogueNetAmount - supplierDiscount);
      const vatRate = Math.max(0, Number($("#reviewVatRate")?.value) || 0);
      const vat = paidNetAmount * vatRate / 100;
      const actualPaidTotal = paidNetAmount + vat;
      const grossBeforeDiscount = catalogueNetAmount + (catalogueNetAmount * vatRate / 100);
      return {
        totalQuantity,
        catalogueNetAmount,
        netAmount:catalogueNetAmount,
        supplierDiscount,
        paidNetAmount,
        totalRrp,
        vatRate,
        vat,
        grossBeforeDiscount,
        grossAmount:actualPaidTotal,
        actualPaidTotal
      };
    };

    updateReviewTotals = function () {
      if (!$("#reviewTotals")) return;
      const totals = getReviewTotals();
      $("#reviewTotalQuantity").textContent = totals.totalQuantity.toLocaleString();
      $("#reviewNetAmount").textContent = currency(totals.catalogueNetAmount);
      if ($("#reviewSupplierDiscount") && Number($("#reviewSupplierDiscount").value) !== totals.supplierDiscount) {
        $("#reviewSupplierDiscount").value = totals.supplierDiscount.toFixed(2);
      }
      if ($("#reviewPaidNetAmount")) $("#reviewPaidNetAmount").textContent = currency(totals.paidNetAmount);
      $("#reviewVatAmount").textContent = currency(totals.vat);
      $("#reviewGrossAmount").textContent = currency(totals.actualPaidTotal);
      $("#reviewTotalRrp").textContent = currency(totals.totalRrp);
    };

    saveReviewedDocument = async function (applyStock) {
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
      const totals = getReviewTotals();
      const status = applyStock ? (documentType === "Credit Note" ? "Applied" : "Imported") : "Uploaded only";
      state.invoices.unshift({
        id:documentId,
        type:documentType,
        stockCategory,
        stockApplied:applyStock,
        supplier,
        date:`${documentDate}T12:00:00`,
        items:lines.reduce((sum, line) => sum + line.qty, 0),
        lines,
        direction:applyStock ? direction : 0,
        catalogueNetAmount:totals.catalogueNetAmount,
        netAmount:totals.catalogueNetAmount,
        supplierDiscount:totals.supplierDiscount,
        paidNetAmount:totals.paidNetAmount,
        vatRate:totals.vatRate,
        vat:totals.vat,
        grossBeforeDiscount:totals.grossBeforeDiscount,
        actualPaidTotal:totals.actualPaidTotal,
        totalRrp:totals.totalRrp,
        total:totals.actualPaidTotal,
        file,
        status
      });
      const activityVerb = applyStock ? (documentType === "Credit Note" ? "applied" : "imported") : "uploaded";
      const discountDetail = totals.supplierDiscount ? ` · ${currency(totals.supplierDiscount)} supplier discount` : "";
      const activityDetail = applyStock ? `${supplier} · ${changedUnits} units ${direction === 1 ? "added" : "returned"}${discountDetail}` : `${supplier} · saved without changing stock${discountDetail}`;
      state.activities.unshift({ type:documentType === "Credit Note" ? "credit" : "invoice", title:`${documentType} ${documentId} ${activityVerb}`, detail:activityDetail, date:new Date().toISOString() });
      saveState(); renderAll(); closeModal();
      if (!applyStock) {
        showToast("Document uploaded", `${documentId} was added to Documents without changing stock.`);
        switchView("invoices");
        return;
      }
      const note = unmatchedUnits ? ` ${unmatchedUnits} unmatched units were not deducted.` : "";
      showToast("Stock updated", `${changedUnits} units ${direction === 1 ? "added" : "returned"} from ${documentId}. Actual paid cost: ${currency(totals.actualPaidTotal)}.${note}`);
      switchView("invoices");
    };

    renderInvoices = function () {
      originalRenderInvoices();
      const invoices = state.invoices.filter(document => (document.type || "Invoice") === "Invoice");
      const credits = state.invoices.filter(document => document.type === "Credit Note");
      const actualPaid = invoices.reduce((sum, document) => sum + documentPaidTotal(document), 0) - credits.reduce((sum, document) => sum + documentPaidTotal(document), 0);
      const discounts = invoices.reduce((sum, document) => sum + documentDiscount(document), 0) - credits.reduce((sum, document) => sum + documentDiscount(document), 0);
      $("#invoiceSummary").innerHTML = [
        ["▤", invoices.length, "Supplier invoices"],
        ["↩", credits.length, "Credit notes applied"],
        ["−", currency(discounts), "Supplier discounts captured"],
        ["€", currency(actualPaid), "Actual supplier spend"]
      ].map(([icon, value, label]) => `<div class="invoice-stat"><span>${icon}</span><div><strong>${value}</strong><small>${label}</small></div></div>`).join("");
    };

    const style = document.createElement("style");
    style.textContent = `
      .supplier-discount-field input { min-width: 108px; }
      .review-totals .supplier-discount-field { display: flex; flex-direction: column; gap: 4px; }
      .review-totals .supplier-discount-field small { white-space: nowrap; }
      @media (max-width: 720px) { .review-totals { align-items: flex-end; } }
    `;
    document.head.append(style);
    renderInvoices();
  }

  installDiscountReporting();
})();
