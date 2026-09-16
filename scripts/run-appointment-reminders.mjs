const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
const cronSecret = process.env.CRON_SECRET?.trim();

if (!appUrl || !cronSecret) {
  console.error("Appointment reminder runner is not configured. NEXT_PUBLIC_APP_URL and CRON_SECRET are required.");
  process.exit(1);
}

let endpoint;
try {
  const origin = new URL(appUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("invalid origin");
  }
  endpoint = new URL("/api/cron/appointment-reminders", origin);
} catch {
  console.error("NEXT_PUBLIC_APP_URL must be an HTTPS origin without a path, query, credentials, or fragment.");
  process.exit(1);
}

try {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      authorization: `Bearer ${cronSecret}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await response.text();
  if (!response.ok) {
    console.error(`Appointment reminder run failed with HTTP ${response.status}.`);
    if (payload) console.error(payload.slice(0, 1_000));
    process.exit(1);
  }

  console.log(`Appointment reminder run completed: ${payload || "{}"}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Appointment reminder run failed: ${message}`);
  process.exit(1);
}
