(function () {
  const DEFAULT_TEAM_MEMBERS = [
    { id:"team-ava", name:"Ava Borg", email:"ava@vanita.com", title:"Beautician", active:true, accessEnabled:true },
    { id:"team-mia", name:"Mia Camilleri", email:"mia@vanita.com", title:"Nail Technician", active:true, accessEnabled:true },
    { id:"team-emma", name:"Emma Grech", email:"emma@vanita.com", title:"Massage Therapist", active:true, accessEnabled:true },
    { id:"team-lea", name:"Lea Vella", email:"lea@vanita.com", title:"Hair Stylist", active:true, accessEnabled:true },
    { id:"team-sara", name:"Sara Attard", email:"sara@vanita.com", title:"Receptionist", active:true, accessEnabled:true }
  ];

  function installServiceTeamModule() {
    if (
      typeof state === "undefined" ||
      typeof normalizeState !== "function" ||
      typeof renderAll !== "function" ||
      typeof setupServiceModal !== "function" ||
      typeof openModal !== "function" ||
      typeof saveState !== "function" ||
      typeof showToast !== "function" ||
      typeof currency !== "function" ||
      typeof escapeHtml !== "function" ||
      typeof makeId !== "function" ||
      !document.querySelector("#addServiceTemplate")
    ) {
      setTimeout(installServiceTeamModule, 25);
      return;
    }
    if (window.__vanitaServiceTeamInstalled) return;
    window.__vanitaServiceTeamInstalled = true;

    const originalNormalizeState = normalizeState;
    const originalRenderAll = renderAll;
    let persistQueued = false;

    const normaliseText = value => String(value || "").trim().toLowerCase();
    const slug = value => String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36);

    function memberId(name) {
      return `team-${slug(name) || String(Date.now()).slice(-6)}`;
    }

    function normaliseMember(member) {
      return {
        id:String(member?.id || memberId(member?.name)).trim(),
        name:String(member?.name || "").trim(),
        email:String(member?.email || "").trim(),
        title:String(member?.title || "Team member").trim(),
        active:member?.active !== false,
        accessEnabled:member?.accessEnabled !== false
      };
    }

    function findMemberByName(data, name) {
      return (data.teamMembers || []).find(member => normaliseText(member.name) === normaliseText(name));
    }

    function addLegacyMember(data, name) {
      const cleanName = String(name || "").trim();
      if (!cleanName) return null;
      const existing = findMemberByName(data, cleanName);
      if (existing) return existing;
      const firstName = slug(cleanName).split("-")[0] || "staff";
      let id = memberId(cleanName);
      let suffix = 2;
      while (data.teamMembers.some(member => member.id === id)) {
        id = `${memberId(cleanName)}-${suffix++}`;
      }
      const member = {
        id,
        name:cleanName,
        email:`${firstName}@vanita.com`,
        title:"Team member",
        active:true,
        accessEnabled:true
      };
      data.teamMembers.push(member);
      return member;
    }

    function ensureTeamState(data) {
      if (!data || typeof data !== "object") return false;
      let changed = false;

      if (!Array.isArray(data.teamMembers)) {
        data.teamMembers = DEFAULT_TEAM_MEMBERS.map(member => ({ ...member }));
        data.teamMembersSeeded = true;
        changed = true;
      } else {
        const normalised = data.teamMembers.map(normaliseMember).filter(member => member.name);
        if (JSON.stringify(normalised) !== JSON.stringify(data.teamMembers)) changed = true;
        data.teamMembers = normalised;
      }

      if (!Array.isArray(data.services)) data.services = [];
      data.services.forEach(service => {
        const legacyNames = Array.isArray(service.staff)
          ? service.staff.map(name => String(name || "").trim()).filter(Boolean)
          : String(service.staff || "").split(",").map(name => name.trim()).filter(Boolean);

        let staffIds = Array.isArray(service.staffIds)
          ? service.staffIds.map(id => String(id || "").trim()).filter(Boolean)
          : [];

        if (!staffIds.length && legacyNames.length) {
          staffIds = legacyNames.map(name => addLegacyMember(data, name)?.id).filter(Boolean);
          changed = true;
        }

        const validIds = [...new Set(staffIds)].filter(id => data.teamMembers.some(member => member.id === id));
        const names = validIds.map(id => data.teamMembers.find(member => member.id === id)?.name).filter(Boolean);

        if (JSON.stringify(service.staffIds || []) !== JSON.stringify(validIds)) changed = true;
        if (JSON.stringify(legacyNames) !== JSON.stringify(names)) changed = true;
        service.staffIds = validIds;
        service.staff = names;
        if (service.code == null) {
          service.code = "";
          changed = true;
        }
      });

      return changed;
    }

    function teamMembersForService(service) {
      const selected = new Set(service?.staffIds || []);
      return state.teamMembers
        .filter(member => (member.active !== false && member.accessEnabled !== false) || selected.has(member.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    function selectedTeamMembers(ids) {
      const selected = new Set(ids || []);
      return state.teamMembers.filter(member => selected.has(member.id));
    }

    function injectStyles() {
      if ($("#serviceTeamStyles")) return;
      const style = document.createElement("style");
      style.id = "serviceTeamStyles";
      style.textContent = `
        .service-staff-field { display:flex; flex-direction:column; gap:10px; }
        .service-staff-field > span:first-child { font-weight:600; color:#344b44; }
        .staff-picker-trigger { width:100%; min-height:46px; padding:11px 14px; border:1px solid #cfdad5; border-radius:10px; background:#fff; color:#27453c; font:inherit; font-weight:700; text-align:left; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:12px; }
        .staff-picker-trigger:hover { border-color:#86a89c; background:#f8fbfa; }
        .staff-picker-trigger small { color:#70817b; font-weight:500; }
        .selected-staff-summary { display:flex; flex-wrap:wrap; gap:7px; min-height:22px; }
        .selected-staff-summary .staff-chip { display:inline-flex; align-items:center; gap:6px; padding:6px 9px; border-radius:999px; background:#edf4f1; color:#315d50; font-size:12px; font-weight:700; }
        .selected-staff-summary .staff-chip small { color:#6d8079; font-weight:500; }
        .selected-staff-summary .staff-empty { color:#7a8883; font-size:13px; }
        .service-staff-picker { border:1px solid #d8e2de; border-radius:12px; background:#f8fbfa; overflow:hidden; }
        .service-staff-picker[hidden] { display:none; }
        .staff-picker-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-bottom:1px solid #e1e8e5; }
        .staff-picker-heading strong { color:#27453c; }
        .staff-picker-heading button { border:0; background:transparent; color:#477266; font:inherit; font-weight:700; cursor:pointer; }
        .staff-choice-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; padding:12px; max-height:290px; overflow:auto; }
        .staff-choice { position:relative; display:flex; align-items:flex-start; gap:10px; padding:12px; border:1px solid #dce5e1; border-radius:10px; background:#fff; cursor:pointer; }
        .staff-choice:has(input:checked) { border-color:#5f9283; box-shadow:0 0 0 2px rgba(95,146,131,.12); background:#f3f8f6; }
        .staff-choice input { margin-top:3px; accent-color:#376e5e; }
        .staff-choice div { display:flex; flex-direction:column; min-width:0; }
        .staff-choice strong { color:#253f37; }
        .staff-choice span { color:#567269; font-size:13px; }
        .staff-choice small { color:#82908b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .staff-access-badge { display:inline-flex; width:max-content; margin-top:5px; padding:3px 6px; border-radius:999px; background:#e8f3ee; color:#34725f; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
        @media (max-width:720px) {
          .staff-choice-list { grid-template-columns:1fr; max-height:340px; }
        }
      `;
      document.head.append(style);
    }

    function enhanceServicesView() {
      const search = $("#servicesSearch");
      if (search) search.placeholder = "Search name, category or qualified staff";
      const header = $$("#servicesView th").find(cell => cell.textContent.trim() === "Code");
      if (header) header.textContent = "Code (optional)";
      const templateCode = $("#addServiceTemplate")?.content?.querySelector('[name="code"]');
      if (templateCode) {
        templateCode.required = false;
        templateCode.placeholder = "Optional internal code";
      }
    }

    function buildStaffPicker(form, service) {
      const originalInput = form.elements.staff;
      const label = originalInput?.closest("label");
      if (!label) return { getSelectedIds:() => [] };

      const selected = new Set(service?.staffIds || []);
      const members = teamMembersForService(service);
      label.className = "wide service-staff-field";
      label.innerHTML = `
        <span>Qualified staff</span>
        <button class="staff-picker-trigger" id="openServiceStaffPicker" type="button">
          <span>Choose team members</span><small id="staffPickerCount"></small>
        </button>
        <div class="selected-staff-summary" id="selectedStaffSummary"></div>
        <div class="service-staff-picker" id="serviceStaffPicker" hidden>
          <div class="staff-picker-heading"><strong>Team members with app access</strong><button id="clearServiceStaff" type="button">Clear selection</button></div>
          <div class="staff-choice-list">
            ${members.map(member => `
              <label class="staff-choice">
                <input type="checkbox" data-team-member-id="${escapeHtml(member.id)}" ${selected.has(member.id) ? "checked" : ""} />
                <div>
                  <strong>${escapeHtml(member.name)}</strong>
                  <span>${escapeHtml(member.title || "Team member")}</span>
                  <small>${escapeHtml(member.email || "No email saved")}</small>
                  <em class="staff-access-badge">${member.accessEnabled !== false ? "App access" : "Access disabled"}</em>
                </div>
              </label>
            `).join("")}
          </div>
        </div>
      `;

      const picker = $("#serviceStaffPicker", form);
      const trigger = $("#openServiceStaffPicker", form);
      const summary = $("#selectedStaffSummary", form);
      const count = $("#staffPickerCount", form);

      const getSelectedIds = () => $$("[data-team-member-id]:checked", form).map(input => input.dataset.teamMemberId);

      const renderSummary = () => {
        const chosen = selectedTeamMembers(getSelectedIds());
        count.textContent = chosen.length ? `${chosen.length} selected` : "Any staff";
        summary.innerHTML = chosen.length
          ? chosen.map(member => `<span class="staff-chip">${escapeHtml(member.name)} <small>${escapeHtml(member.title)}</small></span>`).join("")
          : `<span class="staff-empty">No restriction — the service can be assigned to any staff member during a sale.</span>`;
      };

      trigger.addEventListener("click", () => {
        picker.hidden = !picker.hidden;
        trigger.querySelector("span").textContent = picker.hidden ? "Choose team members" : "Close team-member view";
      });
      picker.addEventListener("change", renderSummary);
      $("#clearServiceStaff", form).addEventListener("click", () => {
        $$("[data-team-member-id]", form).forEach(input => { input.checked = false; });
        renderSummary();
      });
      renderSummary();
      return { getSelectedIds };
    }

    normalizeState = function (data) {
      const normalized = originalNormalizeState(data);
      ensureTeamState(normalized);
      return normalized;
    };

    setupServiceModal = function (serviceId = null) {
      ensureTeamState(state);
      openModal("#addServiceTemplate");
      const service = serviceId ? state.services.find(item => item.id === serviceId) : null;
      const form = $("#serviceForm");
      const codeInput = form.elements.code;
      codeInput.required = false;
      codeInput.placeholder = "Optional internal code";
      const codeLabel = codeInput.closest("label");
      if (codeLabel?.firstChild?.nodeType === Node.TEXT_NODE) codeLabel.firstChild.textContent = "Service code (optional)";

      if (service) {
        $("#modalTitle").textContent = "Edit service";
        $("#saveServiceButton").textContent = "Save changes";
        ["name", "code", "category", "duration", "price", "cost", "vatRate", "description"].forEach(field => {
          if (form.elements[field]) form.elements[field].value = service[field] ?? "";
        });
        form.elements.active.checked = service.active !== false;
      }

      const staffPicker = buildStaffPicker(form, service);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.target));
        const code = String(values.code || "").trim();
        const duplicate = code
          ? state.services.find(item => item.id !== serviceId && normaliseText(item.code) === normaliseText(code))
          : null;
        if (duplicate) return showToast("Service code already used", `${duplicate.name} already uses ${code}.`);

        const staffIds = staffPicker.getSelectedIds();
        const staff = selectedTeamMembers(staffIds).map(member => member.name);
        const details = {
          name:String(values.name || "").trim(),
          code,
          category:values.category,
          duration:Math.max(0, Number(values.duration) || 0),
          price:Math.max(0, Number(values.price) || 0),
          cost:Math.max(0, Number(values.cost) || 0),
          vatRate:Math.max(0, Number(values.vatRate) || 0),
          staffIds,
          staff,
          description:String(values.description || "").trim(),
          active:values.active === "on"
        };

        if (!details.name) return;
        if (service) {
          Object.assign(service, details);
          state.activities.unshift({ type:"invoice", title:`${details.name} updated`, detail:"Service catalogue and qualified staff updated", date:new Date().toISOString() });
        } else {
          state.services.push({ id:makeId("svc"), ...details });
          state.activities.unshift({ type:"invoice", title:`${details.name} added`, detail:`${details.duration} minutes · ${currency(details.price)}`, date:new Date().toISOString() });
        }

        saveState();
        renderAll();
        closeModal();
        showToast(service ? "Service updated" : "Service added", `${details.name} is ${details.active ? "available for sale" : "saved as inactive"}.`);
      });
    };

    renderAll = function () {
      const changed = ensureTeamState(state);
      originalRenderAll();
      enhanceServicesView();
      if (changed && !persistQueued) {
        persistQueued = true;
        setTimeout(() => {
          persistQueued = false;
          saveState();
        }, 0);
      }
    };

    injectStyles();
    enhanceServicesView();
    renderAll();
  }

  installServiceTeamModule();
})();