(function () {
  const BACKUP_SCHEMA = "vanita-stock-backup";
  const BACKUP_VERSION = 1;
  const RELEASE = "v21";

  const PLACEHOLDER_SECTIONS = [
    {
      icon:"◉",
      title:"My account",
      description:"Personal profile, password, appearance and notification preferences.",
      items:["Display name and job title","Change password","Default landing tab","Appearance and table density"]
    },
    {
      icon:"⌂",
      title:"Business profile",
      description:"Business identity and details used throughout the workspace.",
      items:["Business name and logo","Address and contact details","VAT and registration numbers","Currency, timezone and receipt footer"]
    },
    {
      icon:"◎",
      title:"Team and access",
      description:"Employee accounts, roles and operational permissions.",
      items:["Team directory","Owner, Manager, Staff and Developer roles","Feature permissions","Account status and last sign-in"]
    },
    {
      icon:"□",
      title:"Inventory settings",
      description:"Default stock controls and product requirements.",
      items:["Restock defaults","Required product fields","Negative-stock controls","Barcode and stock alerts"]
    },
    {
      icon:"✦",
      title:"Service settings",
      description:"Default treatment rules, pricing and staff assignment behaviour.",
      items:["Default duration and VAT","Service categories","Qualified-staff requirements","Commission and discount controls"]
    },
    {
      icon:"↗",
      title:"Sales settings",
      description:"Checkout, discounts, receipts and completed-sale controls.",
      items:["Sale-number format","Walk-in and client rules","Discount approval limits","Payment methods and receipts"]
    },
    {
      icon:"▤",
      title:"Supplier and document settings",
      description:"Document-import, approval and retention rules.",
      items:["Document defaults","Duplicate-document warnings","AI extraction controls","Retention and approval rules"]
    },
    {
      icon:"♡",
      title:"Clients and privacy",
      description:"Client information, consent and retention controls.",
      items:["Required client fields","Consent and marketing flags","Duplicate detection","Export and deletion requests"]
    },
    {
      icon:"♢",
      title:"Notifications",
      description:"Choose which operational and security events generate alerts.",
      items:["Low-stock alerts","Document-import alerts","Security alerts","Notification recipients"]
    },
    {
      icon:"≡",
      title:"Data and reporting",
      description:"Exports, fiscal settings and scheduled reporting.",
      items:["CSV and JSON exports","Fiscal-year settings","Archived-record controls","Scheduled reports"]
    },
    {
      icon:"⌾",
      title:"Security",
      description:"Authentication, sessions and privileged-access controls.",
      items:["Two-factor authentication","Session duration","Login history","Temporary developer access"]
    },
    {
      icon:"⌘",
      title:"Developer tools",
      description:"Diagnostics, integrity checks and controlled repair utilities.",
      items:["System status","Data-integrity scan","Repair tools","Feature flags and maintenance mode"]
    }
  ];

  const ARRAY_KEYS = ["products", "services", "suppliers", "clients", "sales", "invoices", "activities", "teamMembers"];

  let originalSwitchView = null;
  let pendingRestore = null;
  let accessContext = { privileged:false, role:"Staff", email:"" };

  const normaliseText = value => String(value || "").trim().toLowerCase();
  const clone = value => {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };
  const dateStamp = () => {
    const date = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  };

  function ensureAccessState(data) {
    if (!data.settingsAccess || typeof data.settingsAccess !== "object") {
      data.settingsAccess = { ownerEmails:[], developerEmails:[], bootstrapComplete:false };
    }
    if (!Array.isArray(data.settingsAccess.ownerEmails)) data.settingsAccess.ownerEmails = [];
    if (!Array.isArray(data.settingsAccess.developerEmails)) data.settingsAccess.developerEmails = [];
    return data.settingsAccess;
  }

  async function resolveAccess({ bootstrap = true } = {}) {
    const access = ensureAccessState(state);
    let user = null;
    try {
      const token = await window.VanitaCloud?.getAccessToken?.();
      if (token) {
        const payloadPart = token.split(".")[1] || "";
        const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
        const payload = JSON.parse(decodeURIComponent(escape(atob(padded))));
        user = { email:payload.email || "", app_metadata:payload.app_metadata || {}, user_metadata:payload.user_metadata || {} };
      }
    } catch {}
    const email = normaliseText(user?.email);
    const metadataRole = normaliseText(user?.app_metadata?.role || user?.user_metadata?.role);
    const cloudEnabled = Boolean(window.VanitaCloud?.enabled);

    if (!cloudEnabled) {
      accessContext = { privileged:true, role:"Developer", email:"Local development mode" };
      return accessContext;
    }

    if (["owner", "developer"].includes(metadataRole)) {
      accessContext = { privileged:true, role:metadataRole === "owner" ? "Owner" : "Developer", email:user?.email || "" };
      return accessContext;
    }

    const owner = access.ownerEmails.some(item => normaliseText(item) === email);
    const developer = access.developerEmails.some(item => normaliseText(item) === email);
    if (owner || developer) {
      accessContext = { privileged:true, role:owner ? "Owner" : "Developer", email:user?.email || "" };
      return accessContext;
    }

    const noPrivilegedUsers = access.ownerEmails.length === 0 && access.developerEmails.length === 0;
    if (bootstrap && email && noPrivilegedUsers && access.bootstrapComplete !== true) {
      access.ownerEmails.push(user.email);
      access.bootstrapComplete = true;
      access.bootstrappedAt = new Date().toISOString();
      saveState();
      accessContext = { privileged:true, role:"Owner", email:user.email };
      return accessContext;
    }

    accessContext = { privileged:false, role:"Staff", email:user?.email || "" };
    return accessContext;
  }

  function injectInterface() {
    if (!document.querySelector('[data-view="settings"]')) {
      const salesNav = document.querySelector('.main-nav [data-view="sales"]');
      salesNav?.insertAdjacentHTML("afterend", `
        <button class="nav-item" data-view="settings">
          <span class="nav-icon">⚙</span><span>Settings</span>
        </button>
      `);
    }

    if (!document.querySelector('.mobile-nav [data-view="settings"]')) {
      document.querySelector(".mobile-nav")?.insertAdjacentHTML("beforeend", `
        <button data-view="settings"><span>⚙</span>Settings</button>
      `);
    }

    if (!document.querySelector("#settingsView")) {
      document.querySelector("#salesView")?.insertAdjacentHTML("afterend", `
        <section class="view" id="settingsView">
          <div class="page-heading settings-heading">
            <div>
              <p class="eyebrow">WORKSPACE CONFIGURATION</p>
              <h1>Settings</h1>
              <p>Manage Vanita Stock configuration, privileged tools and workspace data.</p>
            </div>
            <span class="settings-access-pill" id="settingsAccessPill">Checking access…</span>
          </div>
          <div class="settings-placeholder-grid" id="settingsPlaceholderGrid"></div>
          <section class="danger-zone" id="dangerZone">
            <div class="danger-zone-heading">
              <div><p class="eyebrow">PRIVILEGED ACTIONS</p><h2>Danger Zone</h2><p>Backup, restore or reset workspace data. These tools are restricted to the business Owner and Developer.</p></div>
              <span id="dangerAccessStatus">Checking access…</span>
            </div>
            <div class="danger-tool-grid">
              <article class="danger-tool">
                <div class="danger-tool-icon">⇩</div>
                <div><h3>Create Full Backup</h3><p>Download a complete JSON copy of the current application state, including products, services, contacts, sales, documents, team records and settings.</p><small>Original document files remain in secure cloud storage and are represented by their saved metadata.</small></div>
                <button class="danger-secondary-button" data-danger-action="backup">Download backup</button>
              </article>
              <article class="danger-tool">
                <div class="danger-tool-icon">⇧</div>
                <div><h3>Restore From Backup</h3><p>Validate a Vanita Stock backup, review its record counts and either replace the workspace or merge missing records.</p><small>A fresh backup of the current workspace is downloaded before restoration.</small></div>
                <button class="danger-secondary-button" data-danger-action="restore">Choose backup</button>
              </article>
              <article class="danger-tool critical">
                <div class="danger-tool-icon">!</div>
                <div><h3>Reset Individual Data Areas</h3><p>Select specific operational areas to clear without resetting the whole workspace.</p><small>A full backup is downloaded first. Typed confirmation is required before any records are removed.</small></div>
                <button class="danger-primary-button" data-danger-action="reset">Choose data areas</button>
              </article>
            </div>
          </section>
        </section>
      `);
    }

    if (!document.querySelector("#vanitaSettingsTemplates")) {
      const templates = document.createElement("div");
      templates.id = "vanitaSettingsTemplates";
      templates.hidden = true;
      templates.innerHTML = `
        <template id="restoreBackupTemplate">
          <div class="modal-header"><div><p class="eyebrow">DANGER ZONE</p><h2 id="modalTitle">Restore from backup</h2></div><button class="icon-button" data-close-modal>×</button></div>
          <div class="modal-body settings-danger-modal">
            <div class="danger-modal-warning"><span>!</span><div><strong>Review the backup before restoring</strong><p>The current workspace will be backed up automatically before any imported data is applied.</p></div></div>
            <label class="backup-file-picker">
              <span>Backup file</span>
              <input id="restoreBackupFile" type="file" accept=".json,application/json" />
              <small>Select a Vanita Stock JSON backup up to 25 MB.</small>
            </label>
            <div class="backup-validation" id="backupValidation">No backup selected.</div>
            <div id="restorePreview" hidden>
              <div class="backup-count-grid" id="restoreCounts"></div>
              <fieldset class="restore-mode">
                <legend>Restore mode</legend>
                <label><input type="radio" name="restoreMode" value="replace" checked /><span><strong>Replace current workspace</strong><small>Use the backup as the complete source of truth.</small></span></label>
                <label><input type="radio" name="restoreMode" value="merge" /><span><strong>Merge missing records</strong><small>Keep current records and add backup records whose IDs are not already present.</small></span></label>
              </fieldset>
              <label class="typed-confirmation">Type <strong>RESTORE</strong> to continue<input id="restoreConfirmation" autocomplete="off" placeholder="RESTORE" /></label>
            </div>
          </div>
          <div class="modal-footer"><button type="button" class="secondary-button" data-close-modal>Cancel</button><button class="danger-primary-button" id="applyRestore" disabled>Restore backup</button></div>
        </template>
        <template id="resetAreasTemplate">
          <div class="modal-header"><div><p class="eyebrow">DANGER ZONE</p><h2 id="modalTitle">Reset individual data areas</h2></div><button class="icon-button" data-close-modal>×</button></div>
          <div class="modal-body settings-danger-modal">
            <div class="danger-modal-warning"><span>!</span><div><strong>This removes selected workspace data</strong><p>A full backup will be downloaded immediately before the reset is applied.</p></div></div>
            <div class="reset-toolbar"><button type="button" class="text-button" id="selectAllResetAreas">Select all</button><button type="button" class="text-button" id="clearResetAreas">Clear</button><span id="resetSelectionSummary">Nothing selected</span></div>
            <div class="reset-area-list" id="resetAreaList"></div>
            <label class="typed-confirmation">Type <strong>RESET</strong> to continue<input id="resetConfirmation" autocomplete="off" placeholder="RESET" /></label>
          </div>
          <div class="modal-footer"><button type="button" class="secondary-button" data-close-modal>Cancel</button><button class="danger-primary-button" id="applyReset" disabled>Reset selected areas</button></div>
        </template>
      `;
      document.body.append(templates);
    }

    injectStyles();
    renderPlaceholders();
  }

  function injectStyles() {
    if (document.querySelector("#vanitaSettingsStyles")) return;
    const style = document.createElement("style");
    style.id = "vanitaSettingsStyles";
    style.textContent = `
      .settings-heading { align-items:center; }
      .settings-access-pill { display:inline-flex;align-items:center;padding:7px 11px;border-radius:999px;background:#edf4f1;color:#486a60;font-size:11px;font-weight:800;white-space:nowrap; }
      .settings-access-pill.allowed { background:#e4f3ed;color:#236b55; }
      .settings-access-pill.denied { background:#fff0ee;color:#a34e46; }
      .settings-placeholder-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin-bottom:28px; }
      .settings-placeholder-card { display:grid;grid-template-columns:42px 1fr auto;gap:14px;align-items:start;padding:19px;border:1px solid var(--line);border-radius:var(--radius);background:white; }
      .settings-placeholder-icon { display:grid;width:40px;height:40px;place-items:center;border-radius:11px;background:#edf4f1;color:#356e5c;font-size:18px; }
      .settings-placeholder-card h2 { margin:0 0 4px;font:700 15px "Manrope",sans-serif;color:#1c382f; }
      .settings-placeholder-card p { margin:0;color:var(--muted);font-size:11px;line-height:1.5; }
      .settings-placeholder-card ul { grid-column:2 / -1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 16px;margin:4px 0 0;padding:0;list-style:none;color:#65766f;font-size:10px; }
      .settings-placeholder-card li::before { content:"•";margin-right:7px;color:#75a894; }
      .settings-coming-soon { padding:5px 8px;border-radius:999px;background:#f3f4f3;color:#89938f;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em; }
      .danger-zone { padding:22px;border:1px solid #e6aaa4;border-radius:20px;background:#fff8f7;box-shadow:0 1px 0 rgba(120,40,32,.03); }
      .danger-zone-heading { display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding-bottom:18px;border-bottom:1px solid #f1cfcb; }
      .danger-zone-heading h2 { margin:2px 0 5px;font:800 22px "Manrope",sans-serif;color:#8f3f38; }
      .danger-zone-heading p { margin:0;color:#805f5b;font-size:12px; }
      .danger-zone-heading > span { padding:6px 9px;border-radius:999px;background:#f4dedb;color:#8d4b44;font-size:10px;font-weight:800;white-space:nowrap; }
      .danger-zone-heading > span.allowed { background:#e5f1ec;color:#2f6d59; }
      .danger-tool-grid { display:grid;gap:12px;margin-top:16px; }
      .danger-tool { display:grid;grid-template-columns:42px 1fr auto;gap:14px;align-items:center;padding:16px;border:1px solid #edd4d1;border-radius:14px;background:white; }
      .danger-tool.critical { border-color:#dc9b94; }
      .danger-tool-icon { display:grid;width:40px;height:40px;place-items:center;border-radius:11px;background:#fff0ee;color:#aa4f46;font-size:18px;font-weight:800; }
      .danger-tool h3 { margin:0 0 4px;font:700 14px "Manrope",sans-serif;color:#64342f; }
      .danger-tool p { margin:0;color:#755d59;font-size:11px;line-height:1.45; }
      .danger-tool small { display:block;margin-top:5px;color:#9a7772;font-size:9px;line-height:1.4; }
      .danger-primary-button,.danger-secondary-button { border-radius:10px;padding:10px 14px;font:700 11px "DM Sans",sans-serif;cursor:pointer;white-space:nowrap; }
      .danger-primary-button { border:1px solid #a8483f;background:#ad4b42;color:white; }
      .danger-primary-button:hover:not(:disabled) { background:#943d35; }
      .danger-secondary-button { border:1px solid #d7a19b;background:#fff8f7;color:#99473f; }
      .danger-secondary-button:hover:not(:disabled) { background:#ffefed; }
      .danger-primary-button:disabled,.danger-secondary-button:disabled { opacity:.4;cursor:not-allowed; }
      .settings-danger-modal { display:grid;gap:17px; }
      .danger-modal-warning { display:flex;gap:11px;padding:13px;border:1px solid #ebc1bc;border-radius:12px;background:#fff6f4; }
      .danger-modal-warning > span { display:grid;flex:0 0 30px;height:30px;place-items:center;border-radius:9px;background:#b45249;color:white;font-weight:800; }
      .danger-modal-warning strong { color:#713b35;font-size:12px; }
      .danger-modal-warning p { margin:3px 0 0;color:#886b66;font-size:10px;line-height:1.45; }
      .backup-file-picker,.typed-confirmation { display:grid;gap:7px;color:#3d4f49;font-size:11px;font-weight:700; }
      .backup-file-picker input,.typed-confirmation input { width:100%;padding:11px 12px;border:1px solid #d9e1dd;border-radius:10px;background:white;color:#263b34; }
      .backup-file-picker small { color:#87948f;font-size:9px;font-weight:500; }
      .backup-validation { padding:12px;border:1px dashed #d6dfdb;border-radius:10px;background:#fafbfa;color:#73817c;font-size:10px; }
      .backup-validation.valid { border-style:solid;border-color:#a7cbbb;background:#f2f9f6;color:#356b59; }
      .backup-validation.invalid { border-style:solid;border-color:#deb0aa;background:#fff5f3;color:#984a42; }
      .backup-count-grid { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px; }
      .backup-count-grid div { padding:10px;border:1px solid #e3e8e5;border-radius:10px;background:#fbfcfb;text-align:center; }
      .backup-count-grid strong { display:block;color:#29463d;font-size:15px; }
      .backup-count-grid span { color:#7d8b86;font-size:9px; }
      .restore-mode { display:grid;gap:8px;margin:15px 0 0;padding:0;border:0; }
      .restore-mode legend { margin-bottom:8px;color:#41544e;font-size:11px;font-weight:800; }
      .restore-mode label { display:flex;gap:10px;padding:12px;border:1px solid #dfe6e2;border-radius:11px;background:white;cursor:pointer; }
      .restore-mode input { margin-top:3px;accent-color:#2b8b6d; }
      .restore-mode span { display:grid;gap:3px; }
      .restore-mode strong { color:#324a42;font-size:11px; }
      .restore-mode small { color:#7c8a85;font-size:9px; }
      .typed-confirmation { margin-top:15px;color:#7e443e; }
      .reset-toolbar { display:flex;align-items:center;gap:13px; }
      .reset-toolbar .text-button { font-size:10px; }
      .reset-toolbar span { margin-left:auto;color:#7d8a86;font-size:9px; }
      .reset-area-list { display:grid;gap:8px;max-height:360px;overflow:auto; }
      .reset-area-option { display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:start;padding:12px;border:1px solid #e3e7e5;border-radius:11px;background:white;cursor:pointer; }
      .reset-area-option:has(input:checked) { border-color:#d6928b;background:#fff8f7; }
      .reset-area-option input { margin-top:3px;accent-color:#ad4b42; }
      .reset-area-option strong { display:block;color:#4d3b38;font-size:11px; }
      .reset-area-option small { display:block;margin-top:3px;color:#85736f;font-size:9px;line-height:1.4; }
      .reset-area-option em { padding:4px 7px;border-radius:999px;background:#f2f4f3;color:#71817b;font-size:9px;font-style:normal;font-weight:800; }
      @media (max-width:1050px) {
        .settings-placeholder-grid { grid-template-columns:1fr; }
      }
      @media (max-width:780px) {
        .mobile-nav { grid-template-columns:repeat(7,1fr); }
        .settings-placeholder-card,.danger-tool { grid-template-columns:38px 1fr; }
        .settings-placeholder-card > .settings-coming-soon,.danger-tool > button { grid-column:2;width:100%; }
        .settings-placeholder-card ul { grid-column:1 / -1;grid-template-columns:1fr; }
        .danger-zone { padding:16px; }
        .danger-zone-heading { flex-direction:column; }
        .backup-count-grid { grid-template-columns:repeat(2,1fr); }
      }
      @media (max-width:430px) {
        .settings-access-pill { align-self:flex-start; }
      }
    `;
    document.head.append(style);
  }

  function renderPlaceholders() {
    const target = document.querySelector("#settingsPlaceholderGrid");
    if (!target) return;
    target.innerHTML = PLACEHOLDER_SECTIONS.map(section => `
      <article class="settings-placeholder-card">
        <span class="settings-placeholder-icon">${section.icon}</span>
        <div><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.description)}</p></div>
        <span class="settings-coming-soon">Planned</span>
        <ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    `).join("");
  }

  function recordCounts(data = state) {
    return {
      products:Array.isArray(data.products) ? data.products.length : 0,
      services:Array.isArray(data.services) ? data.services.length : 0,
      suppliers:Array.isArray(data.suppliers) ? data.suppliers.length : 0,
      clients:Array.isArray(data.clients) ? data.clients.length : 0,
      sales:Array.isArray(data.sales) ? data.sales.length : 0,
      documents:Array.isArray(data.invoices) ? data.invoices.length : 0,
      activities:Array.isArray(data.activities) ? data.activities.length : 0,
      team:Array.isArray(data.teamMembers) ? data.teamMembers.length : 0
    };
  }

  function renderSettings() {
    const pill = document.querySelector("#settingsAccessPill");
    const status = document.querySelector("#dangerAccessStatus");
    const buttons = document.querySelectorAll("[data-danger-action]");
    if (!pill || !status) return;

    const label = accessContext.privileged
      ? `${accessContext.role} access${accessContext.email && !accessContext.email.includes("mode") ? ` · ${accessContext.email}` : ""}`
      : "Restricted access";
    pill.textContent = label;
    pill.classList.toggle("allowed", accessContext.privileged);
    pill.classList.toggle("denied", !accessContext.privileged);
    status.textContent = accessContext.privileged ? `${accessContext.role} authorised` : "Owner or Developer required";
    status.classList.toggle("allowed", accessContext.privileged);
    buttons.forEach(button => {
      button.disabled = !accessContext.privileged;
      button.title = accessContext.privileged ? "" : "This action requires Owner or Developer access.";
    });
  }

  function createBackupPayload(reason = "manual") {
    return {
      schema:BACKUP_SCHEMA,
      schemaVersion:BACKUP_VERSION,
      application:"Vanita Stock",
      release:RELEASE,
      workspace:{ id:"vanita", name:"Vanita Beauty and Wellness Spa" },
      createdAt:new Date().toISOString(),
      reason,
      counts:recordCounts(state),
      state:clone(state)
    };
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadFullBackup(reason = "manual") {
    const payload = createBackupPayload(reason);
    downloadJson(payload, `vanita-stock-${reason}-backup-${dateStamp()}.json`);
    return payload;
  }

  function requirePrivilege(action) {
    if (accessContext.privileged) return true;
    showToast("Restricted action", `${action} is available only to the workspace Owner or Developer.`);
    return false;
  }

  function validateBackup(parsed) {
    const importedState = parsed?.schema === BACKUP_SCHEMA ? parsed.state : parsed;
    if (!importedState || typeof importedState !== "object" || Array.isArray(importedState)) {
      throw new Error("The selected file does not contain a valid workspace state.");
    }
    const recognised = ARRAY_KEYS.some(key => Array.isArray(importedState[key]));
    if (!recognised) throw new Error("No recognised Vanita Stock data areas were found.");
    if (parsed?.schema === BACKUP_SCHEMA && Number(parsed.schemaVersion) > BACKUP_VERSION) {
      throw new Error("This backup was created by a newer backup format and cannot be restored safely.");
    }
    return clone(importedState);
  }

  function renderCountCards(target, counts) {
    const labels = {
      products:"Products", services:"Services", suppliers:"Suppliers", clients:"Clients",
      sales:"Sales", documents:"Documents", activities:"Activities", team:"Team"
    };
    target.innerHTML = Object.entries(counts).map(([key, value]) => `<div><strong>${value}</strong><span>${labels[key]}</span></div>`).join("");
  }

  function openRestoreModal() {
    if (!requirePrivilege("Restore from backup")) return;
    pendingRestore = null;
    openModal("#restoreBackupTemplate");
    const fileInput = document.querySelector("#restoreBackupFile");
    const validation = document.querySelector("#backupValidation");
    const preview = document.querySelector("#restorePreview");
    const confirmation = document.querySelector("#restoreConfirmation");
    const apply = document.querySelector("#applyRestore");

    const updateApplyState = () => {
      apply.disabled = !pendingRestore || confirmation.value.trim().toUpperCase() !== "RESTORE";
    };

    fileInput.addEventListener("change", async () => {
      pendingRestore = null;
      preview.hidden = true;
      apply.disabled = true;
      const file = fileInput.files?.[0];
      if (!file) {
        validation.className = "backup-validation";
        validation.textContent = "No backup selected.";
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        validation.className = "backup-validation invalid";
        validation.textContent = "The backup is larger than 25 MB.";
        return;
      }
      try {
        const parsed = JSON.parse(await file.text());
        const importedState = validateBackup(parsed);
        pendingRestore = { importedState, fileName:file.name };
        validation.className = "backup-validation valid";
        validation.textContent = `${file.name} passed validation and is ready for review.`;
        renderCountCards(document.querySelector("#restoreCounts"), recordCounts(importedState));
        preview.hidden = false;
        confirmation.value = "";
        confirmation.focus();
      } catch (error) {
        validation.className = "backup-validation invalid";
        validation.textContent = error.message || "The selected backup could not be read.";
      }
    });

    confirmation.addEventListener("input", updateApplyState);
    apply.addEventListener("click", applyRestore);
  }

  function mergeArray(current, incoming, key) {
    const output = clone(Array.isArray(current) ? current : []);
    const identify = item => {
      if (item?.id != null) return `id:${item.id}`;
      if (key === "activities") return `activity:${item?.date || ""}:${item?.title || ""}:${item?.detail || ""}`;
      if (item?.email) return `email:${normaliseText(item.email)}`;
      if (item?.name) return `name:${normaliseText(item.name)}`;
      return `json:${JSON.stringify(item)}`;
    };
    const known = new Set(output.map(identify));
    (Array.isArray(incoming) ? incoming : []).forEach(item => {
      const id = identify(item);
      if (!known.has(id)) {
        output.push(clone(item));
        known.add(id);
      }
    });
    return output;
  }

  function mergeWorkspace(current, incoming) {
    const merged = clone(current);
    ARRAY_KEYS.forEach(key => { merged[key] = mergeArray(merged[key], incoming[key], key); });
    Object.entries(incoming).forEach(([key, value]) => {
      if (ARRAY_KEYS.includes(key) || key === "settingsAccess") return;
      if (merged[key] === undefined) merged[key] = clone(value);
    });
    return merged;
  }

  async function applyRestore() {
    if (!pendingRestore || !requirePrivilege("Restore from backup")) return;
    const mode = document.querySelector('input[name="restoreMode"]:checked')?.value || "replace";
    const button = document.querySelector("#applyRestore");
    button.disabled = true;
    button.textContent = "Restoring…";

    try {
      downloadFullBackup("pre-restore");
      const existingAccess = clone(ensureAccessState(state));
      const imported = normalizeState(clone(pendingRestore.importedState));
      state = mode === "merge"
        ? normalizeState(mergeWorkspace(state, imported))
        : imported;
      const restoredAccess = ensureAccessState(state);
      restoredAccess.ownerEmails = [...new Set([...(restoredAccess.ownerEmails || []), ...(existingAccess.ownerEmails || [])])];
      restoredAccess.developerEmails = [...new Set([...(restoredAccess.developerEmails || []), ...(existingAccess.developerEmails || [])])];
      restoredAccess.bootstrapComplete = restoredAccess.bootstrapComplete === true || existingAccess.bootstrapComplete === true;
      await resolveAccess({ bootstrap:true });
      saveState();
      renderAll();
      renderSettings();
      closeModal();
      originalSwitchView("settings");
      showToast("Backup restored", mode === "merge" ? "Missing backup records were merged into the current workspace." : "The workspace was replaced with the selected backup.");
      pendingRestore = null;
    } catch (error) {
      button.disabled = false;
      button.textContent = "Restore backup";
      showToast("Restore failed", error.message || "The backup could not be restored.");
    }
  }

  function resetAreaDefinitions() {
    return [
      {
        key:"inventory",
        title:"Inventory quantities",
        description:"Sets every product quantity to zero and removes it from the active Inventory view. Product catalogue records remain.",
        count:(state.products || []).filter(product => Number(product.stock) !== 0 || product.inInventory !== false).length
      },
      {
        key:"products",
        title:"Products catalogue",
        description:"Deletes all product and stock records. Historic sales and document line descriptions remain unchanged.",
        count:(state.products || []).length
      },
      {
        key:"services",
        title:"Services catalogue",
        description:"Deletes all service records and qualified-staff links. Historic sale lines retain their saved names and prices.",
        count:(state.services || []).length
      },
      {
        key:"suppliers",
        title:"Supplier directory",
        description:"Deletes supplier contacts and removes supplier names from linked products and document records.",
        count:(state.suppliers || []).length
      },
      {
        key:"clients",
        title:"Client directory",
        description:"Deletes client records and removes client assignments from existing sales.",
        count:(state.clients || []).length
      },
      {
        key:"sales",
        title:"Sales history",
        description:"Deletes all completed sales without changing current product quantities.",
        count:(state.sales || []).length
      },
      {
        key:"documents",
        title:"Supplier documents",
        description:"Deletes document records and attempts to remove their original files from cloud storage. Current stock quantities are not recalculated.",
        count:(state.invoices || []).length
      },
      {
        key:"activities",
        title:"Activity history",
        description:"Clears dashboard activity and alert history only.",
        count:(state.activities || []).length
      }
    ];
  }

  function openResetModal() {
    if (!requirePrivilege("Reset data areas")) return;
    openModal("#resetAreasTemplate");
    const list = document.querySelector("#resetAreaList");
    const confirmation = document.querySelector("#resetConfirmation");
    const apply = document.querySelector("#applyReset");
    const definitions = resetAreaDefinitions();

    list.innerHTML = definitions.map(area => `
      <label class="reset-area-option">
        <input type="checkbox" data-reset-area="${area.key}" />
        <span><strong>${escapeHtml(area.title)}</strong><small>${escapeHtml(area.description)}</small></span>
        <em>${area.count} record${area.count === 1 ? "" : "s"}</em>
      </label>
    `).join("");

    const selectedKeys = () => [...document.querySelectorAll("[data-reset-area]:checked")].map(input => input.dataset.resetArea);
    const updateState = () => {
      const selected = selectedKeys();
      document.querySelector("#resetSelectionSummary").textContent = selected.length ? `${selected.length} area${selected.length === 1 ? "" : "s"} selected` : "Nothing selected";
      apply.disabled = !selected.length || confirmation.value.trim().toUpperCase() !== "RESET";
    };

    list.addEventListener("change", updateState);
    confirmation.addEventListener("input", updateState);
    document.querySelector("#selectAllResetAreas").addEventListener("click", () => {
      document.querySelectorAll("[data-reset-area]").forEach(input => { input.checked = true; });
      updateState();
    });
    document.querySelector("#clearResetAreas").addEventListener("click", () => {
      document.querySelectorAll("[data-reset-area]").forEach(input => { input.checked = false; });
      updateState();
    });
    apply.addEventListener("click", () => applyReset(selectedKeys()));
  }

  async function applyReset(selected) {
    if (!selected.length || !requirePrivilege("Reset data areas")) return;
    const button = document.querySelector("#applyReset");
    button.disabled = true;
    button.textContent = "Resetting…";
    let storageFailures = 0;

    try {
      downloadFullBackup("pre-reset");

      if (selected.includes("documents")) {
        const paths = (state.invoices || []).map(document => document.file?.path).filter(Boolean);
        const results = await Promise.allSettled(paths.map(path => window.VanitaCloud?.deleteDocumentFile?.(path)));
        storageFailures = results.filter(result => result.status === "rejected").length;
      }

      if (selected.includes("inventory")) {
        state.products = (state.products || []).map(product => ({ ...product, stock:0, inInventory:false }));
      }
      if (selected.includes("products")) state.products = [];
      if (selected.includes("services")) state.services = [];
      if (selected.includes("suppliers")) {
        state.suppliers = [];
        (state.products || []).forEach(product => { product.supplier = ""; });
        (state.invoices || []).forEach(document => { document.supplier = ""; });
      }
      if (selected.includes("clients")) {
        state.clients = [];
        (state.sales || []).forEach(sale => {
          delete sale.clientId;
          delete sale.clientName;
        });
      }
      if (selected.includes("sales")) state.sales = [];
      if (selected.includes("documents")) state.invoices = [];
      if (selected.includes("activities")) state.activities = [];

      state = normalizeState(state);
      saveState();
      renderAll();
      renderSettings();
      closeModal();
      originalSwitchView("settings");
      const message = storageFailures
        ? `Selected data areas were reset. ${storageFailures} original document file${storageFailures === 1 ? "" : "s"} could not be removed from cloud storage.`
        : "Selected data areas were reset successfully.";
      showToast("Data reset complete", message);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Reset selected areas";
      showToast("Reset failed", error.message || "The selected data areas could not be reset.");
    }
  }

  function wireEvents() {
    document.querySelectorAll('[data-view="settings"]').forEach(button => {
      button.addEventListener("click", () => switchView("settings"));
    });

    document.querySelector("#settingsView")?.addEventListener("click", event => {
      const button = event.target.closest("[data-danger-action]");
      if (!button) return;
      if (button.dataset.dangerAction === "backup" && requirePrivilege("Create full backup")) {
        downloadFullBackup("manual");
        showToast("Backup created", "A complete JSON backup has been downloaded.");
      }
      if (button.dataset.dangerAction === "restore") openRestoreModal();
      if (button.dataset.dangerAction === "reset") openResetModal();
    });
  }

  async function openSettings(view) {
    originalSwitchView(view);
    if (view !== "settings") return;
    await resolveAccess({ bootstrap:true });
    renderSettings();
  }

  function install() {
    if (
      typeof state === "undefined" ||
      typeof switchView !== "function" ||
      typeof openModal !== "function" ||
      typeof closeModal !== "function" ||
      typeof normalizeState !== "function" ||
      typeof renderAll !== "function" ||
      typeof saveState !== "function" ||
      typeof showToast !== "function" ||
      typeof escapeHtml !== "function" ||
      !document.querySelector(".main-nav") ||
      !document.querySelector(".mobile-nav")
    ) {
      setTimeout(install, 30);
      return;
    }
    if (window.__vanitaSettingsInstalled) return;
    window.__vanitaSettingsInstalled = true;

    originalSwitchView = switchView;
    switchView = openSettings;
    ensureAccessState(state);
    injectInterface();
    wireEvents();
    resolveAccess({ bootstrap:false }).then(renderSettings);
    window.VanitaSettings = {
      createBackup:() => accessContext.privileged && downloadFullBackup("manual"),
      openRestore:openRestoreModal,
      openReset:openResetModal
    };
  }

  install();
})();