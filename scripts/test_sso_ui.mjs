import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../public/sso-settings.js", import.meta.url), "utf8");
const { ssoMarkup, renderSSOMaster } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const manifest = JSON.parse(await readFile(new URL("../config/sso_spaces.json", import.meta.url), "utf8"));
const origins = (item) => item.project_id ? { public_url: `https://${item.project_id}.mycafe24.ai` } : {};
const data = { ...manifest, summary: { total_spaces: 20, occupied_spaces: 15, reserved_spaces: 5, registered_clients: 14, configured_clients: 14, master_ready: true }, spaces: manifest.spaces.map(item => ({ ...item, ...origins(item), connection_status: item.kind === "portal" ? "master_ready" : item.project_id ? "registered" : "reserved" })) };
data.spaces[0].display_name = '<img src=x onerror="alert(1)">';
const markup = ssoMarkup(data);
assert(!markup.includes('<img src=x'));
assert(!markup.includes('<script>alert'));
assert(markup.includes('&lt;img'));
assert.equal((markup.match(/class="sso-download"/g) || []).length, 14);
assert.equal((markup.match(/class="sso-badge reserved"/g) || []).length, 5);
assert(markup.includes('중앙 인증 서버 운영 준비 완료'));

// A delayed response must not overwrite another admin tab.
let resolveFetch;
globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
const root = { innerHTML: "loading", querySelector: () => ({ addEventListener() {} }) };
let currentRoot = root;
const host = { innerHTML: "", querySelector: () => currentRoot };
const pending = renderSSOMaster(host);
currentRoot = null;
host.innerHTML = "다른 관리 탭";
resolveFetch({ ok: true, json: async () => data });
await pending;
assert.equal(root.innerHTML, "loading");
assert.equal(host.innerHTML, "다른 관리 탭");

// Errors remain text, with a retry control.
currentRoot = root;
globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: '<img src=x onerror="alert(1)">' }) });
await renderSSOMaster(host);
assert(root.innerHTML.includes('data-sso-retry'));
assert(!root.innerHTML.includes('<img src=x'));
console.log("SSO master UI: escaping, 20-space rendering, downloads, tab-switch race, error retry passed.");
