(function () {
  const PAYMENT_METHODS = ["Cash", "Card", "Bank transfer", "Revolut", "Voucher", "Other"];
  let selectedPaymentMethod = "";
  let activeSaleId = null;

  function installPaymentMethodModule() {
    if (
      typeof state === "undefined" ||
      typeof normalizeState !== "function" ||
      typeof setupSaleModal !== "function" ||
      typeof saveSale !== "function" ||
      typeof renderSales !== "function" ||
      typeof saveState !== "function" ||
      typeof renderAll !== "function" ||
      !window.__vanitaContactsInstalled ||
      !window.__vanitaCalendarInstalled
    ) {
      setTimeout(installPaymentMethodModule, 35);
      return;
    }
    if (window.__vanitaPaymentMethodInstalled) return;
    window.__vanitaPaymentMethodInstalled = true;

    const originalNormalizeState = normalizeState;
    const originalSetupSaleModal = setupSaleModal;
    const originalSaveSale = saveSale;
    const originalRenderSales = renderSales;

    function ensurePaymentState(data) {
      if (!data || typeof data !== "object") return data;
      if (!Array.isArray(data.sales)) data.sales = [];
      data.sales = data.sales.map(sale => ({
        ...sale,
        paymentMethod:String(sale?.paymentMethod || "").trim()
      }));
      return data;
    }

    normalizeState = function (data) {
      return ensurePaymentState(originalNormalizeState(data));
    };
    ensurePaymentState(state);

    function injectStyles() {
      if (document.querySelector("#vanitaPaymentMethodStyles")) return;
      const style = document.createElement("style");
      style.id = "vanitaPaymentMethodStyles";
      style.textContent = `
        .sale-payment-section { margin:18px 0; padding:16px; border:1px solid #d8e2de; border-radius:12px; background:#f8fbfa; }
        .sale-payment-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:11px; }
        .sale-payment-heading strong { display:block; color:#243f37; }
        .sale-payment-heading small { display:block; margin-top:3px; color:#71817b; }
        .sale-payment-required { padding:4px 8px; border-radius:999px; background:#fff0e5; color:#a85b20; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
        .sale-payment-section select { width:100%; min-height:46px; padding:11px 13px; border:1px solid #cdd9d4; border-radius:10px; background:#fff; color:#243f37; font:inherit; }
        .sale-payment-section.payment-error { border-color:#c8695f; background:#fff7f5; box-shadow:0 0 0 3px rgba(200,105,95,.1); }
        .sale-payment-section.payment-error select { border-color:#c8695f; }
        .payment-required-overlay { position:fixed; inset:0; z-index:10050; display:grid; place-items:center; padding:20px; background:rgba(12,34,29,.58); }
        .payment-required-dialog { position:relative; width:min(420px,100%); padding:24px; border-radius:16px; background:#fff; box-shadow:0 24px 70px rgba(7,29,23,.3); }
        .payment-required-dialog > span { display:grid; place-items:center; width:44px; height:44px; margin-bottom:14px; border-radius:12px; background:#fff0e5; color:#a85b20; font-size:22px; font-weight:800; }
        .payment-required-dialog h2 { margin:0 36px 8px 0; color:#19372f; font:800 22px/1.2 Manrope, sans-serif; }
        .payment-required-dialog p { margin:0 0 20px; color:#62756e; line-height:1.55; }
        .payment-required-dialog .payment-popup-close { position:absolute; top:14px; right:14px; width:34px; height:34px; border:0; border-radius:9px; background:#f2f6f4; color:#45635a; font-size:20px; cursor:pointer; }
        .payment-required-dialog .primary-button { width:100%; justify-content:center; }
      `;
      document.head.append(style);
    }

    function injectPaymentField() {
      injectStyles();
      const checkoutStep = document.querySelector("#saleCheckoutStep");
      const checkoutSummary = document.querySelector("#checkoutSummary");
      if (!checkoutStep || !checkoutSummary || document.querySelector("#salePaymentMethod")) return;

      const section = document.createElement("div");
      section.className = "sale-payment-section";
      section.id = "salePaymentSection";
      section.innerHTML = `
        <div class="sale-payment-heading">
          <div><strong>Payment method</strong><small>Select how the customer paid for this sale.</small></div>
          <span class="sale-payment-required">Required</span>
        </div>
        <select id="salePaymentMethod" aria-label="Payment method" required>
          <option value="">Choose a payment method</option>
          ${PAYMENT_METHODS.map(method => `<option value="${method}">${method}</option>`).join("")}
        </select>
      `;
      checkoutSummary.insertAdjacentElement("beforebegin", section);
      const select = section.querySelector("select");
      select.value = selectedPaymentMethod;
      select.addEventListener("change", () => {
        selectedPaymentMethod = select.value;
        section.classList.remove("payment-error");
        select.removeAttribute("aria-invalid");
      });
    }

    function closePaymentPopup(focusField = false) {
      document.querySelector(".payment-required-overlay")?.remove();
      if (focusField) {
        const field = document.querySelector("#salePaymentMethod");
        field?.focus({ preventScroll:false });
        field?.scrollIntoView({ behavior:"smooth", block:"center" });
      }
    }

    function showPaymentRequiredPopup() {
      closePaymentPopup();
      injectStyles();
      const overlay = document.createElement("div");
      overlay.className = "payment-required-overlay";
      overlay.innerHTML = `
        <section class="payment-required-dialog" role="alertdialog" aria-modal="true" aria-labelledby="paymentRequiredTitle" aria-describedby="paymentRequiredText">
          <button class="payment-popup-close" type="button" aria-label="Close">×</button>
          <span>!</span>
          <h2 id="paymentRequiredTitle">Payment method required</h2>
          <p id="paymentRequiredText">Select how the customer paid before completing this sale.</p>
          <button class="primary-button" type="button" data-choose-payment>Choose payment method</button>
        </section>
      `;
      document.body.append(overlay);
      overlay.querySelector(".payment-popup-close").addEventListener("click", () => closePaymentPopup(true));
      overlay.querySelector("[data-choose-payment]").addEventListener("click", () => closePaymentPopup(true));
      overlay.addEventListener("click", event => { if (event.target === overlay) closePaymentPopup(true); });
      overlay.querySelector("[data-choose-payment]").focus();
    }

    setupSaleModal = function (saleId = null) {
      activeSaleId = saleId;
      const sale = saleId ? state.sales.find(item => item.id === saleId) : null;
      selectedPaymentMethod = String(sale?.paymentMethod || "").trim();
      originalSetupSaleModal(saleId);
      injectPaymentField();
    };

    saveSale = function () {
      const field = document.querySelector("#salePaymentMethod");
      const method = String(field?.value || selectedPaymentMethod || "").trim();
      if (!method) {
        document.querySelector("#salePaymentSection")?.classList.add("payment-error");
        field?.setAttribute("aria-invalid", "true");
        showPaymentRequiredPopup();
        return;
      }

      selectedPaymentMethod = method;
      const saleIdBeforeSave = activeSaleId || (typeof editingSaleId !== "undefined" ? editingSaleId : null);
      const existingIds = new Set(state.sales.map(sale => sale.id));
      originalSaveSale();

      const completed = document.querySelector("#modalBackdrop")?.hidden === true;
      if (!completed) return;

      const savedSale = saleIdBeforeSave
        ? state.sales.find(sale => sale.id === saleIdBeforeSave)
        : state.sales.find(sale => !existingIds.has(sale.id));
      if (savedSale) {
        savedSale.paymentMethod = method;
        savedSale.paymentRecordedAt = new Date().toISOString();
        const activity = state.activities.find(item => String(item.title || "").includes(`Sale ${savedSale.id}`));
        if (activity && !String(activity.detail || "").includes("Payment:")) activity.detail = `${activity.detail || ""} · Payment: ${method}`.replace(/^ · /, "");
        saveState();
        renderAll();
      }

      activeSaleId = null;
      selectedPaymentMethod = "";
    };

    renderSales = function () {
      originalRenderSales();
      document.querySelectorAll("#salesList .activity-item").forEach((row, index) => {
        const sale = state.sales[index];
        if (!sale?.paymentMethod) return;
        const detail = row.querySelector("p");
        if (detail && !detail.textContent.includes("Payment:")) detail.textContent += ` · Payment: ${sale.paymentMethod}`;
      });
    };

    window.VanitaPaymentMethods = {
      methods:[...PAYMENT_METHODS],
      required:true
    };
  }

  installPaymentMethodModule();
})();