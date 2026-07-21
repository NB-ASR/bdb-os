(function () {
  function installTopActions() {
    if (
      typeof setupSaleModal !== "function" ||
      !window.VanitaCalendar?.openAppointment ||
      !document.querySelector(".topbar .top-actions")
    ) {
      setTimeout(installTopActions, 35);
      return;
    }
    if (window.__vanitaTopActionsInstalled) return;
    window.__vanitaTopActionsInstalled = true;

    const topActions = document.querySelector(".topbar .top-actions");
    const scanButton = topActions.querySelector('[data-action="scan-invoice"]');
    if (!scanButton) return;

    const actionGroup = document.createElement("div");
    actionGroup.className = "topbar-quick-actions";
    actionGroup.innerHTML = `
      <button class="secondary-button compact topbar-quick-action" type="button" data-topbar-action="record-sale" title="Record a sale">
        <span class="button-icon">↗</span><span class="topbar-action-label">Record Sale</span>
      </button>
      <button class="primary-button compact topbar-quick-action" type="button" data-topbar-action="book-appointment" title="Book an appointment">
        <span class="button-icon">▦</span><span class="topbar-action-label">Book Appointment</span>
      </button>
    `;
    scanButton.replaceWith(actionGroup);

    if (!document.querySelector("#vanitaTopActionsStyles")) {
      const style = document.createElement("style");
      style.id = "vanitaTopActionsStyles";
      style.textContent = `
        .topbar-quick-actions { display:flex;align-items:center;gap:8px; }
        .topbar-quick-action { display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap; }
        @media (max-width:1100px) {
          .topbar-quick-action { width:40px;padding-left:0;padding-right:0; }
          .topbar-action-label { display:none; }
        }
        @media (max-width:720px) {
          .topbar-quick-actions { gap:5px; }
          .topbar-quick-action { width:36px;min-height:36px; }
        }
      `;
      document.head.append(style);
    }

    actionGroup.addEventListener("click", event => {
      const button = event.target.closest("[data-topbar-action]");
      if (!button) return;
      if (button.dataset.topbarAction === "record-sale") setupSaleModal();
      if (button.dataset.topbarAction === "book-appointment") {
        window.VanitaCalendar.openAppointment(null, {
          date:new Date().toISOString().slice(0, 10),
          startTime:"09:00"
        });
      }
    });
  }

  installTopActions();
})();
