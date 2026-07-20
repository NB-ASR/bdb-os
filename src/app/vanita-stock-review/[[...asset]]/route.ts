import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projectRoot = resolve(process.cwd(), "projects", "vanita-stock");
const allowedAssets = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "cloud.js",
  "discount-reporting.js",
  "icon.svg",
  "manifest.webmanifest",
  "service-worker.js",
]);

const contentTypes: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "cloud.js": "text/javascript; charset=utf-8",
  "discount-reporting.js": "text/javascript; charset=utf-8",
  "icon.svg": "image/svg+xml; charset=utf-8",
  "manifest.webmanifest": "application/manifest+json; charset=utf-8",
  "service-worker.js": "text/javascript; charset=utf-8",
};

function reviewHtml(source: string) {
  const apiPrefix = `<script>
    (() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (typeof input === "string" && input.startsWith("/api/")) {
          return nativeFetch("/vanita-stock-review" + input, init);
        }
        return nativeFetch(input, init);
      };
    })();
  </script>`;

  return source
    .replace('<meta name="theme-color" content="#132b25" />', '<meta name="theme-color" content="#0d0e0d" />')
    .replace("<head>", '<head><base href="/vanita-stock-review/" />')
    .replace("<title>Vanita Stock — Beauty inventory made simple</title>", "<title>Vanita Stock · BDB OS Review</title>")
    .replace('<link rel="stylesheet" href="styles.css" />', `<link rel="stylesheet" href="styles.css" />${apiPrefix}`);
}

function reviewManifest(source: string) {
  const manifest = JSON.parse(source) as Record<string, unknown>;
  manifest.background_color = "#0d0e0d";
  manifest.theme_color = "#0d0e0d";
  manifest.start_url = "/vanita-stock-review/";
  return JSON.stringify(manifest, null, 2);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ asset?: string[] }> },
) {
  const { asset } = await context.params;
  const requestedAsset = asset?.join("/") || "index.html";

  if (!allowedAssets.has(requestedAsset)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = resolve(projectRoot, requestedAsset);
  if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${sep}`)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(filePath);
    let body: BodyInit = file;

    if (requestedAsset === "index.html") body = reviewHtml(file.toString("utf8"));
    if (requestedAsset === "manifest.webmanifest") body = reviewManifest(file.toString("utf8"));
    if (requestedAsset === "service-worker.js") {
      body = file.toString("utf8").replace('const CACHE = "vanita-stock-v17";', 'const CACHE = "vanita-stock-v18-bdb-review";');
    }

    const headers = new Headers({
      "Content-Type": contentTypes[requestedAsset] || "application/octet-stream",
      "Cache-Control": requestedAsset === "index.html" ? "no-store" : "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Robots-Tag": "noindex, nofollow",
    });

    if (requestedAsset === "service-worker.js") {
      headers.set("Service-Worker-Allowed", "/vanita-stock-review/");
    }

    return new Response(body, { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
