(function () {
  const TEST_VERSION = true;
  const DOCUMENT_DB_NAME = "vanita-stock-local-files";
  const DOCUMENT_DB_VERSION = 1;
  const DOCUMENT_STORE = "documents";
  const EXTRACTION_TOKEN = "test-version";

  let documentDatabasePromise = null;

  function openDocumentDatabase() {
    if (!window.indexedDB) {
      return Promise.reject(new Error("This browser does not support local document storage."));
    }
    if (documentDatabasePromise) return documentDatabasePromise;

    documentDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DOCUMENT_DB_NAME, DOCUMENT_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
          database.createObjectStore(DOCUMENT_STORE, { keyPath:"path" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Local document storage could not be opened."));
      request.onblocked = () => reject(new Error("Local document storage is blocked by another app tab."));
    });

    return documentDatabasePromise;
  }

  async function runDocumentTransaction(mode, operation) {
    const database = await openDocumentDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DOCUMENT_STORE, mode);
      const store = transaction.objectStore(DOCUMENT_STORE);
      let request;
      try {
        request = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("The local document operation failed."));
      transaction.onerror = () => reject(transaction.error || new Error("The local document transaction failed."));
    });
  }

  async function connect() {
    const authScreen = document.querySelector("#authScreen");
    const signOutButton = document.querySelector("#signOutButton");
    const status = document.querySelector("#cloudStatus");

    if (authScreen) authScreen.hidden = true;
    if (signOutButton) signOutButton.hidden = true;
    if (status) {
      status.textContent = "Test Version";
      status.classList.add("online");
      status.title = "No login is required. Workspace data and document files are stored in this browser.";
    }

    return { enabled:false, testVersion:true };
  }

  async function loadState() {
    return null;
  }

  async function saveState() {
    // Application state is persisted by app.js in localStorage.
  }

  async function signOut() {
    location.reload();
  }

  async function getAccessToken() {
    // This is not an authentication credential. It only identifies requests from the test build.
    return EXTRACTION_TOKEN;
  }

  async function uploadDocument(file, documentId) {
    if (!(file instanceof Blob)) throw new Error("No document file was supplied.");
    const extension = (String(file.name || "document").split(".").pop() || "file").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const safeId = String(documentId || "document").replace(/[^a-z0-9_-]/gi, "-").slice(0, 50);
    const path = `local/${Date.now()}-${safeId}.${extension || "file"}`;
    const record = {
      path,
      name:file.name || `${safeId}.${extension || "file"}`,
      mimeType:file.type || "application/octet-stream",
      size:Number(file.size) || 0,
      createdAt:new Date().toISOString(),
      blob:file
    };

    try {
      await runDocumentTransaction("readwrite", store => store.put(record));
    } catch (error) {
      throw new Error(error?.message || "The original file could not be saved in this browser.");
    }

    return {
      path:record.path,
      name:record.name,
      mimeType:record.mimeType,
      size:record.size,
      storage:"browser"
    };
  }

  async function getDocumentUrl(path) {
    if (!path) throw new Error("No original file is attached to this document.");
    let record;
    try {
      record = await runDocumentTransaction("readonly", store => store.get(path));
    } catch (error) {
      throw new Error(error?.message || "The saved document could not be read from this browser.");
    }
    if (!record?.blob) throw new Error("This document file is not stored in this browser.");
    const url = URL.createObjectURL(record.blob);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    return url;
  }

  async function deleteDocumentFile(path) {
    if (!path) return;
    try {
      await runDocumentTransaction("readwrite", store => store.delete(path));
    } catch (error) {
      throw new Error(error?.message || "The local document file could not be deleted.");
    }
  }

  window.VanitaCloud = {
    connect,
    loadState,
    saveState,
    signOut,
    getAccessToken,
    uploadDocument,
    getDocumentUrl,
    deleteDocumentFile,
    get enabled() { return false; },
    get testVersion() { return TEST_VERSION; },
    get publicTestMode() { return false; }
  };

  const enhancements = document.createElement("script");
  enhancements.src = "discount-reporting.js";
  enhancements.defer = true;
  document.head.append(enhancements);

  const contacts = document.createElement("script");
  contacts.src = "contacts.js";
  contacts.defer = true;
  document.head.append(contacts);

  const serviceTeam = document.createElement("script");
  serviceTeam.src = "service-team.js";
  serviceTeam.defer = true;
  document.head.append(serviceTeam);

  const quickGuide = document.createElement("script");
  quickGuide.src = "quick-guide.js";
  quickGuide.defer = true;
  document.head.append(quickGuide);

  const settings = document.createElement("script");
  settings.src = "settings.js";
  settings.defer = true;
  document.head.append(settings);
})();