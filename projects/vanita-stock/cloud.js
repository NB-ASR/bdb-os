(function () {
  let client = null;
  let cloudEnabled = false;
  let revision = 0;
  let pendingState = null;
  let flushPromise = null;
  let conflictDetected = false;

  function status(message, tone = "") {
    const element = document.querySelector("#cloudStatus");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("online", tone === "online");
    element.dataset.tone = tone;
  }

  function snapshot(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function normaliseSharedState(value) {
    const data = value && typeof value === "object" ? value : {};
    return {
      ...data,
      products: Array.isArray(data.products) ? data.products : [],
      services: Array.isArray(data.services) ? data.services : [],
      invoices: Array.isArray(data.invoices) ? data.invoices : [],
      sales: Array.isArray(data.sales) ? data.sales : [],
      activities: Array.isArray(data.activities) ? data.activities : []
    };
  }

  async function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js";
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the secure cloud connection library."));
      document.head.append(script);
    });
  }

  async function fetchConfiguration() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) return null;
      const config = await response.json();
      return config.configured ? config : null;
    } catch {
      return null;
    }
  }

  async function waitForSignIn() {
    const screen = document.querySelector("#authScreen");
    const form = document.querySelector("#loginForm");
    const error = document.querySelector("#authError");
    screen.hidden = false;

    return new Promise(resolve => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        error.hidden = true;
        const button = form.querySelector("button[type='submit']");
        button.disabled = true;
        button.textContent = "Signing in…";

        const { data, error: signInError } = await client.auth.signInWithPassword({
          email: document.querySelector("#loginEmail").value.trim(),
          password: document.querySelector("#loginPassword").value
        });

        button.disabled = false;
        button.textContent = "Sign in securely";
        if (signInError) {
          error.textContent = "The email or password was not accepted.";
          error.hidden = false;
          return;
        }

        screen.hidden = true;
        resolve(data.session);
      });
    });
  }

  async function connect() {
    const config = await fetchConfiguration();
    if (!config) {
      status("Local demo", "local");
      return { enabled: false };
    }
    await loadSupabaseLibrary();

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    let { data: { session }, error } = await client.auth.getSession();
    if (error) throw new Error("The saved session could not be verified.");
    if (!session) session = await waitForSignIn();
    cloudEnabled = true;
    document.querySelector("#signOutButton").hidden = false;
    status("Cloud connected", "online");
    return { enabled: true, session };
  }

  async function loadState() {
    if (!cloudEnabled) return null;
    const { data, error } = await client.from("app_state").select("data,revision").eq("id", "vanita").maybeSingle();
    if (error) {
      throw new Error(error.message.includes("revision")
        ? "The Vanita cloud schema must be upgraded before shared editing can continue."
        : error.message);
    }
    if (!data) throw new Error("The Vanita shared workspace record is missing.");
    revision = Number(data.revision) || 0;
    conflictDetected = false;
    status("Changes saved", "online");
    return normaliseSharedState(data.data);
  }

  function isConflict(error) {
    return error?.code === "40001" || String(error?.message || "").includes("STATE_CONFLICT");
  }

  async function flushPendingState() {
    if (!cloudEnabled || conflictDetected || flushPromise) return flushPromise;
    flushPromise = (async () => {
      while (pendingState && cloudEnabled && !conflictDetected) {
        if (!navigator.onLine) {
          status("Offline · local changes kept", "offline");
          break;
        }
        const nextState = pendingState;
        pendingState = null;
        status("Saving…", "saving");
        const { data, error } = await client.rpc("save_vanita_state", {
          p_data: nextState,
          p_expected_revision: revision
        });
        if (error) {
          pendingState = nextState;
          if (isConflict(error)) {
            conflictDetected = true;
            status("Conflict · reload required", "error");
            window.dispatchEvent(new CustomEvent("vanita-cloud-conflict"));
          } else {
            status("Save failed · local copy kept", "error");
          }
          break;
        }
        const result = Array.isArray(data) ? data[0] : data;
        revision = Number(result?.revision) || revision + 1;
        status(pendingState ? "Saving newer changes…" : "Changes saved", "online");
      }
    })().finally(() => { flushPromise = null; });
    return flushPromise;
  }

  function saveState(state) {
    if (!cloudEnabled) return Promise.resolve(false);
    pendingState = snapshot(state);
    return flushPendingState().then(() => !pendingState && !conflictDetected);
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    location.reload();
  }

  async function getAccessToken() {
    if (!client) return null;
    const { data: { session }, error } = await client.auth.getSession();
    if (error) return null;
    return session?.access_token || null;
  }

  async function uploadDocument(file, documentId) {
    if (!client || !cloudEnabled) throw new Error("Cloud storage is unavailable.");
    const extension = (file.name.split(".").pop() || "file").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const safeId = documentId.replace(/[^a-z0-9_-]/gi, "-").slice(0, 50);
    const path = `${Date.now()}-${safeId}.${extension}`;
    const { error } = await client.storage.from("documents").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw new Error(`The original file could not be saved: ${error.message}`);
    return { path, name:file.name, mimeType:file.type || "application/octet-stream" };
  }

  async function getDocumentUrl(path, downloadName = null) {
    if (!client || !path) throw new Error("No original file is attached to this document.");
    const options = downloadName ? { download:downloadName } : {};
    const { data, error } = await client.storage.from("documents").createSignedUrl(path, 300, options);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async function deleteDocumentFile(path) {
    if (!client || !path) return;
    const { error } = await client.storage.from("documents").remove([path]);
    if (error) throw new Error(`The stored file could not be deleted: ${error.message}`);
  }

  window.addEventListener("online", () => { if (pendingState && !conflictDetected) void flushPendingState(); });
  window.addEventListener("offline", () => { if (cloudEnabled) status("Offline · local changes kept", "offline"); });

  window.VanitaCloud = {
    connect,
    loadState,
    saveState,
    signOut,
    getAccessToken,
    uploadDocument,
    getDocumentUrl,
    deleteDocumentFile,
    get enabled() { return cloudEnabled; },
    get hasConflict() { return conflictDetected; }
  };

  const enhancements = document.createElement("script");
  enhancements.src = "discount-reporting.js";
  enhancements.defer = true;
  document.head.append(enhancements);
})();
