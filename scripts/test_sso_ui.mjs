import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../public/sso-settings.js", import.meta.url), "utf8");
const { ssoMarkup, renderSSOPreparation } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const manifest = JSON.parse(await readFile(new URL("../config/sso_spaces.json", import.meta.url), "utf8"));
const data = { ...manifest, summary: { total_spaces: 20, occupied_spaces: 11, reserved_spaces: 9, active_sso_sites: 0 }, spaces: manifest.spaces.map(item => ({ ...item, auth_label: "로그인 확인", remaining_tasks: ["사이트별 확인"] })) };
data.spaces[0].display_name = '<img src=x onerror="alert(1)">';
data.spaces[0].remaining_tasks = ['<script>alert(1)</script>'];
const markup = ssoMarkup(data);
assert(!markup.includes('<img src=x'));
assert(!markup.includes('<script>alert'));
assert(markup.includes('&lt;img'));
assert.equal((markup.match(/class="sso-download"/g) || []).length, 11);
assert.equal((markup.match(/class="sso-badge reserved"/g) || []).length, 9);
assert(markup.includes('통합 로그인 적용 전'));

// A delayed response must not overwrite another admin tab.
let resolveFetch;
globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
const root = { innerHTML: "loading", querySelector: () => ({ addEventListener() {} }) };
let currentRoot = root;
const host = { innerHTML: "", querySelector: () => currentRoot };
const pending = renderSSOPreparation(host);
currentRoot = null;
host.innerHTML = "다른 관리 탭";
resolveFetch({ ok: true, json: async () => data });
await pending;
assert.equal(root.innerHTML, "loading");
assert.equal(host.innerHTML, "다른 관리 탭");

// Errors remain text, with a retry control.
currentRoot = root;
globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: '<img src=x onerror="alert(1)">' }) });
await renderSSOPreparation(host);
assert(root.innerHTML.includes('data-sso-retry'));
assert(!root.innerHTML.includes('<img src=x'));
console.log("SSO UI: escaping, 20-space rendering, downloads, tab-switch race, error retry passed.");
