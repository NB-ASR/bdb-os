(function () {
  let client = null;
  let cloudEnabled = false;
  let syncing = false;

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
          error.textContent = signInError.message;
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
    if (!config) return { enabled: false };
    await loadSupabaseLibrary();

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    let { data: { session } } = await client.auth.getSession();
    if (!session) session = await waitForSignIn();
    cloudEnabled = true;
    document.querySelector("#signOutButton").hidden = false;
    document.querySelector("#cloudStatus").textContent = "Cloud synced";
    document.querySelector("#cloudStatus").classList.add("online");
    return { enabled: true, session };
  }

  async function loadState() {
    if (!cloudEnabled) return null;
    const { data, error } = await client.from("app_state").select("data").eq("id", "vanita").maybeSingle();
    if (error) throw error;
    return data?.data || null;
  }

  async function saveState(state) {
    if (!cloudEnabled || syncing) return;
    syncing = true;
    document.querySelector("#cloudStatus").textContent = "Syncing…";
    try {
      const { error } = await client.from("app_state").upsert({ id: "vanita", data: state, updated_at: new Date().toISOString() });
      if (error) throw error;
      document.querySelector("#cloudStatus").textContent = "Cloud synced";
    } catch (error) {
      document.querySelector("#cloudStatus").textContent = "Sync failed";
      console.error("Vanita cloud sync failed", error);
    } finally {
      syncing = false;
    }
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    location.reload();
  }

  async function getAccessToken() {
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
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

  window.VanitaCloud = { connect, loadState, saveState, signOut, getAccessToken, uploadDocument, getDocumentUrl, deleteDocumentFile, get enabled() { return cloudEnabled; } };

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