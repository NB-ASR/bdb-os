(function () {
  const VIEW_TITLES = {
    dashboard: "Overview",
    inventory: "Inventory",
    products: "Products",
    services: "Services",
    suppliers: "Suppliers",
    clients: "Clients",
    invoices: "Documents",
    sales: "Sales"
  };

  const TOUR_STEPS = {
    dashboard: [
      { target:"#dashboardView .page-heading", title:"Overview", text:"This is the daily summary for Vanita Stock. It gives you a quick picture of sales, stock value and items that need attention.", placement:"bottom" },
      { target:"#metricGrid", title:"Key figures", text:"These cards summarise the most important stock and sales figures. They update automatically when products, documents or sales change.", placement:"bottom" },
      { target:"#dashboardView .restock-panel", title:"Restock alerts", text:"Products at or below their restock level appear here so staff can see what should be reordered first.", placement:"right" },
      { target:"#dashboardView .stock-chart-panel", title:"Stock movement", text:"This chart compares stock added and stock removed during the week.", placement:"left" },
      { target:"#dashboardView .activity-panel", title:"Recent activity", text:"The latest sales, supplier documents and stock alerts are recorded here.", placement:"top" },
      { target:".top-search", title:"Global search", text:"Use this search to find products, services, suppliers or clients from anywhere in the app.", placement:"bottom" },
      { target:[".topbar [data-action='scan-invoice']", ".mobile-scan"], title:"Scan a document", text:"Open the document importer to photograph or upload a supplier invoice or credit note.", placement:"bottom" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use the navigation menu to move between stock, catalogues, contacts, documents and sales.", placement:"right" }
    ],
    inventory: [
      { target:"#inventoryView .page-heading", title:"Inventory", text:"This tab shows the products currently held in stock and highlights quantities that need attention.", placement:"bottom" },
      { target:"#inventoryView .heading-actions", title:"Inventory actions", text:"Import a supplier document to update stock, or open the Products catalogue to maintain product details.", placement:"bottom" },
      { target:"#inventorySearch", title:"Inventory search", text:"Search the stock list by product name, SKU, category or barcode.", placement:"bottom" },
      { target:"#inventoryView .filter-chips", title:"Stock filters", text:"Switch between all stock, low-stock items and products that are out of stock.", placement:"bottom" },
      { target:["#inventoryView .table-panel thead", "#inventoryView .table-panel"], title:"Stock table", text:"Each row shows the product, its purpose, current quantity, restock level and stock status. Products can also be removed from Inventory without deleting their catalogue record.", placement:"top" },
      { target:".top-search", title:"Global search", text:"Use the global search to jump directly to matching catalogue or contact records.", placement:"bottom" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use this menu to move to another part of Vanita Stock.", placement:"right" }
    ],
    products: [
      { target:"#productsView .page-heading", title:"Products", text:"This catalogue stores the full details of every retail product and business supply.", placement:"bottom" },
      { target:"#productsView [data-action='add-product']", title:"Add a product", text:"Create a new product record with its SKU, barcode, supplier, cost, selling price and restock level.", placement:"bottom" },
      { target:"#productsSearch", title:"Product search", text:"Search the catalogue by product name, SKU, brand or supplier.", placement:"bottom" },
      { target:["#productsView .table-panel thead", "#productsView .table-panel"], title:"Product catalogue", text:"Review product details, pricing and stock controls here. Use Edit to update a record or Delete to remove it permanently.", placement:"top" },
      { target:".top-search", title:"Global search", text:"The global search can locate products and other records without leaving the current area first.", placement:"bottom" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use this menu to move to Inventory, Services, contacts, Documents or Sales.", placement:"right" }
    ],
    services: [
      { target:"#servicesView .page-heading", title:"Services", text:"This catalogue stores Vanita's treatments, prices, duration, VAT and qualified team members.", placement:"bottom" },
      { target:"#servicesView [data-action='add-service']", title:"Add a service", text:"Create a treatment and optionally assign an internal service code and qualified employees.", placement:"bottom" },
      { target:"#serviceSummary", title:"Service summary", text:"These cards show active services, monthly service sales, service revenue and the most popular treatment.", placement:"bottom" },
      { target:"#servicesSearch", title:"Service search", text:"Search by service name, category or qualified employee.", placement:"bottom" },
      { target:"#serviceCategoryFilter", title:"Category filter", text:"Limit the list to a particular treatment category, such as Nails, Facials or Massage.", placement:"bottom" },
      { target:"#servicesView .filter-chips", title:"Availability filters", text:"Show all services, only active services or treatments that have been archived.", placement:"bottom" },
      { target:["#servicesView .table-panel thead", "#servicesView .table-panel"], title:"Service catalogue", text:"Each row shows the service details, qualified staff and availability. Services can be edited, archived or deleted from here.", placement:"top" },
      { target:"#servicesView .service-insights", title:"Service reporting", text:"These panels break down monthly service revenue by category and by the employee selected during each sale.", placement:"top" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use this menu to open another area of the application.", placement:"right" }
    ],
    suppliers: [
      { target:"#suppliersView .page-heading", title:"Suppliers", text:"This directory keeps supplier contact details together with their linked products, documents and purchasing history.", placement:"bottom" },
      { target:"#suppliersView [data-action='add-supplier']", title:"Add a supplier", text:"Create a supplier record with contact, VAT, address and account notes.", placement:"bottom" },
      { target:"#supplierSummary", title:"Supplier summary", text:"See the number of suppliers, active supplier accounts, assigned products and total net supplier spend.", placement:"bottom" },
      { target:"#supplierSearch", title:"Supplier search", text:"Search by supplier name, contact person, email, telephone number or VAT number.", placement:"bottom" },
      { target:["#suppliersView .table-panel thead", "#suppliersView .table-panel"], title:"Supplier directory", text:"Review supplier contacts, linked records and spend. Suppliers with linked records should be archived rather than deleted.", placement:"top" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use this menu to move to another tab.", placement:"right" }
    ],
    clients: [
      { target:"#clientsView .page-heading", title:"Clients", text:"This directory stores client contact details, treatment preferences, notes and sales history.", placement:"bottom" },
      { target:"#clientsView [data-action='add-client']", title:"Add a client", text:"Create a client record that can later be assigned to a sale.", placement:"bottom" },
      { target:"#clientSummary", title:"Client summary", text:"See active clients, linked sales and revenue associated with identified clients.", placement:"bottom" },
      { target:"#clientSearch", title:"Client search", text:"Search by client name, email, telephone number, preferences or notes.", placement:"bottom" },
      { target:["#clientsView .table-panel thead", "#clientsView .table-panel"], title:"Client directory", text:"Review visits, spend and latest activity. Clients with linked sales are archived instead of permanently deleted.", placement:"top" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use this menu to move to another tab.", placement:"right" }
    ],
    invoices: [
      { target:"#invoicesView .page-heading", title:"Documents", text:"This tab keeps the supplier invoices and credit notes imported into Vanita Stock.", placement:"bottom" },
      { target:"#invoicesView [data-action='scan-invoice']", title:"Scan a new document", text:"Photograph or upload an invoice or credit note, review the extracted details and decide whether it should update stock.", placement:"bottom" },
      { target:"#invoiceSummary", title:"Purchasing summary", text:"These cards summarise supplier invoices, credit notes and net purchasing value.", placement:"bottom" },
      { target:["#invoicesView .table-panel thead", "#invoicesView .table-panel"], title:"Document history", text:"Open, download or delete stored supplier documents here. Stock movements are reversed when a compatible document is deleted.", placement:"top" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use this menu to move to another tab.", placement:"right" }
    ],
    sales: [
      { target:"#salesView .page-heading", title:"Sales", text:"This tab records completed product and service sales, including discounts, clients and assigned service staff.", placement:"bottom" },
      { target:"#salesView [data-action='record-sale']", title:"Record a sale", text:"Open the sales screen to add products and services, select staff, assign a client and review discounts before checkout.", placement:"bottom" },
      { target:"#salesView .sales-layout > .panel", title:"Recent sales", text:"Completed sales appear here. Open a compatible sale to correct it, or delete it to reverse its product stock movement.", placement:"right" },
      { target:"#salesView .scan-card", title:"Sales scanner", text:"This shortcut opens the same sales screen. Products can be found with a camera, handheld scanner or typed barcode.", placement:"left" },
      { target:[".main-nav", ".mobile-nav"], title:"App navigation", text:"Use this menu to move to another tab.", placement:"right" }
    ]
  };

  let root = null;
  let steps = [];
  let currentIndex = 0;
  let currentTarget = null;
  let previousFocus = null;
  let updateTimer = null;

  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const resolveTarget = target => {
    const selectors = Array.isArray(target) ? target : [target];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (visible(element)) return element;
    }
    return null;
  };

  function activeViewName() {
    const active = document.querySelector(".view.active");
    return active?.id?.replace(/View$/, "") || "dashboard";
  }

  function injectStyles() {
    if (document.querySelector("#vanitaGuideStyles")) return;
    const style = document.createElement("style");
    style.id = "vanitaGuideStyles";
    style.textContent = `
      .vanita-guide { position:fixed; inset:0; z-index:2147483000; pointer-events:none; font-family:"DM Sans",system-ui,sans-serif; }
      .vanita-guide-mask { position:fixed; background:rgba(7,27,23,.74); pointer-events:auto; transition:all .2s ease; }
      .vanita-guide-target { position:fixed; border:3px solid #80dec0; border-radius:14px; box-shadow:0 0 0 5px rgba(128,222,192,.22),0 12px 34px rgba(0,0,0,.2); pointer-events:auto; transition:all .2s ease; }
      .vanita-guide-bubble { position:fixed; width:min(370px,calc(100vw - 28px)); padding:22px 22px 15px; border:1px solid rgba(30,91,75,.16); border-radius:18px; background:#fff; color:#1c3c33; box-shadow:0 22px 65px rgba(4,24,19,.3); pointer-events:auto; transition:left .2s ease,top .2s ease; }
      .vanita-guide-bubble h2 { margin:0 36px 8px 0; font-family:"Manrope",system-ui,sans-serif; font-size:20px; line-height:1.25; color:#173a31; }
      .vanita-guide-bubble p { margin:0; color:#536e65; font-size:14px; line-height:1.55; }
      .vanita-guide-close { position:absolute; top:12px; right:12px; width:34px; height:34px; border:0; border-radius:10px; background:#edf5f2; color:#28584b; font:700 22px/1 system-ui,sans-serif; cursor:pointer; }
      .vanita-guide-close:hover { background:#dcece6; }
      .vanita-guide-footer { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:14px; margin-top:18px; padding-top:13px; border-top:1px solid #e4ece9; }
      .vanita-guide-arrow-button { display:grid; place-items:center; width:40px; height:38px; border:1px solid #bfd3cc; border-radius:11px; background:#f7fbf9; color:#246652; font:700 22px/1 system-ui,sans-serif; cursor:pointer; }
      .vanita-guide-arrow-button:last-child { justify-self:end; }
      .vanita-guide-arrow-button:hover:not(:disabled) { background:#e8f4ef; border-color:#8db5a8; }
      .vanita-guide-arrow-button:disabled { opacity:.32; cursor:not-allowed; }
      .vanita-guide-counter { min-width:58px; text-align:center; color:#527268; font-size:13px; font-weight:800; letter-spacing:.04em; }
      .vanita-guide-pointer { position:absolute; width:18px; height:18px; background:#fff; transform:rotate(45deg); border:1px solid rgba(30,91,75,.16); }
      .vanita-guide-bubble[data-placement="bottom"] .vanita-guide-pointer { top:-10px; left:var(--guide-arrow-x,50%); margin-left:-9px; border-right:0; border-bottom:0; }
      .vanita-guide-bubble[data-placement="top"] .vanita-guide-pointer { bottom:-10px; left:var(--guide-arrow-x,50%); margin-left:-9px; border-left:0; border-top:0; }
      .vanita-guide-bubble[data-placement="right"] .vanita-guide-pointer { left:-10px; top:var(--guide-arrow-y,50%); margin-top:-9px; border-right:0; border-top:0; }
      .vanita-guide-bubble[data-placement="left"] .vanita-guide-pointer { right:-10px; top:var(--guide-arrow-y,50%); margin-top:-9px; border-left:0; border-bottom:0; }
      .vanita-guide-bubble[data-placement="center"] .vanita-guide-pointer { display:none; }
      @media (max-width:720px) {
        .vanita-guide-bubble { padding:19px 18px 13px; border-radius:16px; }
        .vanita-guide-bubble h2 { font-size:18px; }
        .vanita-guide-bubble p { font-size:13px; }
      }
    `;
    document.head.append(style);
  }

  function buildOverlay() {
    root = document.createElement("div");
    root.className = "vanita-guide";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Vanita Stock quick guide");
    root.innerHTML = `
      <div class="vanita-guide-mask" data-mask="top"></div>
      <div class="vanita-guide-mask" data-mask="left"></div>
      <div class="vanita-guide-mask" data-mask="right"></div>
      <div class="vanita-guide-mask" data-mask="bottom"></div>
      <div class="vanita-guide-target" aria-hidden="true"></div>
      <section class="vanita-guide-bubble" aria-live="polite">
        <span class="vanita-guide-pointer" aria-hidden="true"></span>
        <button class="vanita-guide-close" type="button" aria-label="Close quick guide">×</button>
        <h2></h2>
        <p></p>
        <div class="vanita-guide-footer">
          <button class="vanita-guide-arrow-button" data-guide-prev type="button" aria-label="Previous tutorial item">←</button>
          <span class="vanita-guide-counter"></span>
          <button class="vanita-guide-arrow-button" data-guide-next type="button" aria-label="Next tutorial item">→</button>
        </div>
      </section>
    `;
    document.body.append(root);
    root.querySelector(".vanita-guide-close").addEventListener("click", closeGuide);
    root.querySelector("[data-guide-prev]").addEventListener("click", () => showStep(currentIndex - 1));
    root.querySelector("[data-guide-next]").addEventListener("click", () => showStep(currentIndex + 1));
  }

  function maskAround(rect) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 7;
    const left = Math.max(0, rect.left - gap);
    const top = Math.max(0, rect.top - gap);
    const right = Math.min(viewportWidth, rect.right + gap);
    const bottom = Math.min(viewportHeight, rect.bottom + gap);
    const middleHeight = Math.max(0, bottom - top);

    const set = (name, values) => Object.assign(root.querySelector(`[data-mask="${name}"]`).style, values);
    set("top", { left:"0px", top:"0px", width:`${viewportWidth}px`, height:`${top}px` });
    set("left", { left:"0px", top:`${top}px`, width:`${left}px`, height:`${middleHeight}px` });
    set("right", { left:`${right}px`, top:`${top}px`, width:`${Math.max(0, viewportWidth - right)}px`, height:`${middleHeight}px` });
    set("bottom", { left:"0px", top:`${bottom}px`, width:`${viewportWidth}px`, height:`${Math.max(0, viewportHeight - bottom)}px` });

    Object.assign(root.querySelector(".vanita-guide-target").style, {
      left:`${left}px`, top:`${top}px`, width:`${Math.max(0, right - left)}px`, height:`${middleHeight}px`
    });
    return { left, top, right, bottom, width:right - left, height:middleHeight };
  }

  function choosePlacement(rect, bubbleRect, preferred) {
    const gap = 18;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaces = {
      bottom:vh - rect.bottom,
      top:rect.top,
      right:vw - rect.right,
      left:rect.left
    };
    const required = {
      bottom:bubbleRect.height + gap,
      top:bubbleRect.height + gap,
      right:bubbleRect.width + gap,
      left:bubbleRect.width + gap
    };
    const order = [preferred, "bottom", "top", "right", "left"].filter((item, index, array) => item && array.indexOf(item) === index);
    return order.find(placement => spaces[placement] >= required[placement]) || order.sort((a, b) => spaces[b] - spaces[a])[0] || "center";
  }

  function positionBubble(rect) {
    const bubble = root.querySelector(".vanita-guide-bubble");
    const margin = 14;
    const gap = 18;
    bubble.style.visibility = "hidden";
    bubble.style.left = "0px";
    bubble.style.top = "0px";
    const bubbleRect = bubble.getBoundingClientRect();
    const preferred = steps[currentIndex]?.placement || "bottom";
    const placement = choosePlacement(rect, bubbleRect, preferred);
    let left = margin;
    let top = margin;

    if (placement === "bottom" || placement === "top") {
      left = rect.left + rect.width / 2 - bubbleRect.width / 2;
      top = placement === "bottom" ? rect.bottom + gap : rect.top - bubbleRect.height - gap;
    } else if (placement === "right" || placement === "left") {
      left = placement === "right" ? rect.right + gap : rect.left - bubbleRect.width - gap;
      top = rect.top + rect.height / 2 - bubbleRect.height / 2;
    } else {
      left = (window.innerWidth - bubbleRect.width) / 2;
      top = (window.innerHeight - bubbleRect.height) / 2;
    }

    left = Math.max(margin, Math.min(left, window.innerWidth - bubbleRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - bubbleRect.height - margin));
    bubble.dataset.placement = placement;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.setProperty("--guide-arrow-x", `${Math.max(18, Math.min(bubbleRect.width - 18, rect.left + rect.width / 2 - left))}px`);
    bubble.style.setProperty("--guide-arrow-y", `${Math.max(18, Math.min(bubbleRect.height - 18, rect.top + rect.height / 2 - top))}px`);
    bubble.style.visibility = "visible";
  }

  function updatePosition() {
    if (!root || !currentTarget) return;
    const raw = currentTarget.getBoundingClientRect();
    const rect = {
      left:Math.max(8, raw.left),
      top:Math.max(8, raw.top),
      right:Math.min(window.innerWidth - 8, raw.right),
      bottom:Math.min(window.innerHeight - 8, raw.bottom)
    };
    rect.width = Math.max(1, rect.right - rect.left);
    rect.height = Math.max(1, rect.bottom - rect.top);
    const highlighted = maskAround(rect);
    positionBubble(highlighted);
  }

  function showStep(index) {
    if (!root || index < 0 || index >= steps.length) return;
    currentIndex = index;
    const step = steps[index];
    currentTarget = resolveTarget(step.target);
    if (!currentTarget) return closeGuide();

    root.querySelector("h2").textContent = step.title;
    root.querySelector("p").textContent = step.text;
    root.querySelector(".vanita-guide-counter").textContent = `${index + 1}/${steps.length}`;
    root.querySelector("[data-guide-prev]").disabled = index === 0;
    root.querySelector("[data-guide-next]").disabled = index === steps.length - 1;

    currentTarget.scrollIntoView({ behavior:"smooth", block:"center", inline:"nearest" });
    updatePosition();
    clearTimeout(updateTimer);
    updateTimer = setTimeout(updatePosition, 280);
  }

  function handleKeydown(event) {
    if (!root) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeGuide();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showStep(currentIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      showStep(currentIndex - 1);
    }
  }

  function startGuide() {
    closeGuide();
    const view = activeViewName();
    const configured = TOUR_STEPS[view] || TOUR_STEPS.dashboard;
    steps = configured.filter(step => resolveTarget(step.target));
    if (!steps.length) return;
    previousFocus = document.activeElement;
    document.querySelector("#sidebar")?.classList.remove("open");
    injectStyles();
    buildOverlay();
    document.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    root.setAttribute("aria-label", `${VIEW_TITLES[view] || "Current tab"} quick guide`);
    showStep(0);
    root.querySelector(".vanita-guide-close").focus({ preventScroll:true });
  }

  function closeGuide() {
    clearTimeout(updateTimer);
    if (root) root.remove();
    root = null;
    currentTarget = null;
    steps = [];
    document.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("resize", updatePosition);
    window.removeEventListener("scroll", updatePosition, true);
    if (previousFocus?.focus) previousFocus.focus({ preventScroll:true });
    previousFocus = null;
  }

  function install() {
    const button = document.querySelector("#openGuide");
    if (!button) return setTimeout(install, 30);
    if (button.dataset.contextGuideInstalled === "true") return;
    button.dataset.contextGuideInstalled = "true";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      startGuide();
    }, true);
    window.VanitaQuickGuide = { open:startGuide, close:closeGuide };
  }

  install();
})();
