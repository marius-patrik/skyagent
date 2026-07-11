import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accessoriesForPlayer } from "@skyagent/core/accessories";
import { inventoryForPlayer } from "@skyagent/core/inventory";
import { networthForPlayer } from "@skyagent/core/networth";
import { compactProfileOverview, fetchProfileContext } from "@skyagent/core/profile";
import { progressionForPlayer } from "@skyagent/core/sections";
import { providerStatus } from "@skyagent/core/providers";

export type ServeWebOptions = {
  host?: string;
  port?: number;
  distDir?: string;
};

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function defaultDistDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
}

function safeJoin(root: string, requestPath: string) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^[/\\]+/, "");
  const target = path.join(root, normalized);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return target;
}

function responseFromFile(filePath: string) {
  const headers = new Headers();
  headers.set("content-type", MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream");
  headers.set("cache-control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
  return new Response(Bun.file(filePath), { headers });
}

function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function applicationResponse(url: URL) {
  const player = url.searchParams.get("player") || undefined;
  const profile = url.searchParams.get("profile") || undefined;
  switch (url.pathname) {
    case "/api/overview":
      return jsonResponse(compactProfileOverview(await fetchProfileContext(player, profile)));
    case "/api/inventory":
      return jsonResponse(await inventoryForPlayer(player, profile));
    case "/api/networth":
      return jsonResponse(await networthForPlayer(player, profile, { maxItems: 100, timeoutMs: 5_000, includeItems: false }));
    case "/api/accessories":
      return jsonResponse(await accessoriesForPlayer(player, profile, { maxPriceLookups: 40, timeoutMs: 4_000 }));
    case "/api/progression":
      return jsonResponse(await progressionForPlayer(player, profile));
    case "/api/provider-status":
      return jsonResponse(providerStatus());
    default:
      return jsonResponse({ error: "unknown SkyAgent application route" }, 404);
  }
}

export function serveWeb(options: ServeWebOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 18473;
  const distDir = options.distDir ?? defaultDistDir();
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    throw new Error(`SkyAgent web bundle is missing at ${distDir}. Run 'bun run --cwd packages/web build' before serving.`);
  }

  return Bun.serve({
    hostname: host,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        try {
          return await applicationResponse(url);
        } catch (error) {
          return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      }
      const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = safeJoin(distDir, requestPath);
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return responseFromFile(filePath);
      }
      return responseFromFile(path.join(distDir, "index.html"));
    },
  });
}

function parseArg(name: string, fallback: string) {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) {
    return inline.slice(name.length + 3);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

if (import.meta.main) {
  const host = parseArg("host", "127.0.0.1");
  const port = Number(parseArg("port", "18473"));
  const server = serveWeb({ host, port });
  console.log(`SkyAgent web listening on http://${server.hostname}:${server.port}`);
}
