/**
 * Generates TypeScript types and an ENDPOINTS constant from the Context Markets
 * OpenAPI spec. Run via: bun scripts/generate-api.ts
 */
import fs from "node:fs";
import path from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const SPEC_URL = process.argv[2] || "https://api-testnet.context.markets/v2/openapi.json";
const OUT_DIR = path.join(import.meta.dirname, "..", "src", "generated");

// ---------------------------------------------------------------------------
// Override map: maps OpenAPI paths to the key names used in the existing SDK.
// Only non-obvious mappings need to be listed here. Paths not listed will be
// auto-derived from the last path segment(s) using camelCase.
// ---------------------------------------------------------------------------
const KEY_OVERRIDES: Record<string, string> = {
  // account
  "/account/migration": "migration",
  "/account/migration/start": "migrationStart",
  "/account/migration/dismiss-orders": "migrationDismissOrders",
  "/account/migration/restore-orders": "migrationRestoreOrders",
  "/account/migration/migrate-funds": "migrationMigrateFunds",

  // markets
  "/markets": "list",
  "/markets/{id}": "get",
  "/markets/{id}/prices": "prices",

  // questions
  "/questions": "submit",
  "/questions/submissions/{id}": "submission",
  "/questions/agent-submit": "agentSubmit",

  // orders — /orders serves both GET (list) and POST (create); same path string
  "/orders": "create",
  "/orders/{id}": "get",
  "/orders/cancel-replace": "cancelReplace",
  "/orders/bulk/create": "bulkCreate",
  "/orders/bulk/cancel": "bulkCancel",

  // balance
  "/balance": "tokenBalance",
  "/balance/{address}": "get",
  "/balance/settlement": "settlement",
  "/balance/mint-test-usdc": "mintTestUsdc",

  // portfolio
  "/portfolio/{address}": "get",
  "/portfolio/{address}/claimable": "claimable",
  "/portfolio/{address}/positions": "positions",
  "/portfolio/{address}/stats": "stats",

  // activity
  "/activity": "global",

  // gasless
  "/gasless/operator": "operator",
  "/gasless/deposit-with-permit": "depositWithPermit",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine which top-level group a path belongs to. */
function groupForPath(p: string): string {
  const segments = p.replace(/^\//, "").split("/");
  return segments[0];
}

/** Derive a camelCase key from a path if no override exists. */
function defaultKeyForPath(p: string): string {
  const segments = p.replace(/^\//, "").split("/");
  // Drop the group prefix and any path params
  const rest = segments.slice(1).filter((s) => !s.startsWith("{"));
  if (rest.length === 0) return "list";
  // camelCase join
  return rest
    .map((s, i) => {
      const camel = s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return i === 0 ? camel : camel.charAt(0).toUpperCase() + camel.slice(1);
    })
    .join("");
}

/** Does this path have any {param} segments? */
function hasParams(p: string): boolean {
  return /\{[^}]+\}/.test(p);
}

/** Extract ordered param names from a path. */
function paramNames(p: string): string[] {
  const matches = [...p.matchAll(/\{([^}]+)\}/g)];
  return matches.map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Fetching spec from ${SPEC_URL}...`);
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`Failed to fetch spec: ${res.status}`);
  const spec = (await res.json()) as { paths: Record<string, unknown> };

  // --- 1. Generate types via openapi-typescript ---
  console.log("Generating types...");
  const ast = await openapiTS(new URL(SPEC_URL));
  const typesSource = astToString(ast);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const typesPath = path.join(OUT_DIR, "api-types.ts");
  fs.writeFileSync(typesPath, typesSource, "utf-8");
  console.log(`  → ${path.relative(process.cwd(), typesPath)}`);

  // --- 2. Generate ENDPOINTS constant ---
  console.log("Generating endpoints...");
  const paths = Object.keys(spec.paths);

  // Group paths by top-level segment
  const groups = new Map<string, Map<string, string>>();
  for (const p of paths) {
    const group = groupForPath(p);
    if (!groups.has(group)) groups.set(group, new Map());
    const key = KEY_OVERRIDES[p] ?? defaultKeyForPath(p);
    // Deduplicate: if two methods on the same path, they share a key
    groups.get(group)!.set(key, p);
  }

  // Also add the "list" alias for /orders since the SDK exposes both list and create
  // pointing to the same path string
  if (groups.has("orders")) {
    const ordersGroup = groups.get("orders")!;
    if (!ordersGroup.has("list") && ordersGroup.has("create")) {
      ordersGroup.set("list", "/orders");
    }
  }

  // Build the source text
  let endpointsSrc = `/**\n * Auto-generated from the Context public OpenAPI spec.\n * DO NOT EDIT — re-run \`bun run generate\` instead.\n */\n\n`;
  endpointsSrc += `export const ENDPOINTS = {\n`;

  for (const [group, entries] of groups) {
    endpointsSrc += `  ${group}: {\n`;
    for (const [key, p] of entries) {
      if (hasParams(p)) {
        const params = paramNames(p);
        const paramList = params.map((n) => `${n}: string`).join(", ");
        // Build the template literal
        const template = p.replace(
          /\{([^}]+)\}/g,
          (_, name) => `\${${name}}`
        );
        endpointsSrc += `    ${key}: (${paramList}) => \`${template}\` as const,\n`;
      } else {
        endpointsSrc += `    ${key}: "${p}",\n`;
      }
    }
    endpointsSrc += `  },\n`;
  }

  endpointsSrc += `} as const;\n`;

  const endpointsPath = path.join(OUT_DIR, "endpoints.ts");
  fs.writeFileSync(endpointsPath, endpointsSrc, "utf-8");
  console.log(`  → ${path.relative(process.cwd(), endpointsPath)}`);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
