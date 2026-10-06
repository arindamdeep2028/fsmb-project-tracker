// Browser and API regression tests for SEC-3, 4, 5, 6, 9, 14 and 17. LOCAL STACK ONLY: it deactivates and demotes
// seed users, changes a password and uploads files, so it refuses to run unless every address is on
// 127.0.0.1 / localhost. Never point it at production.
//
// Not part of `npm test`. Needs a freshly reset local database (migrations + seed.sql), the Supabase API on API_URL
// with Storage and both Edge Functions of this repo, the built app on BASE_URL, and the packages playwright-core,
// pg and @supabase/supabase-js resolvable from where the file is run.
//   ANON_KEY, SEED_PASSWORD (the local seed accounts' password)        Run:  node security.e2e.mjs
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://127.0.0.1:54321";
const PG_URL = process.env.PG_URL ?? "postgresql://postgres@127.0.0.1:54330/fsmb_local";
const ANON = process.env.ANON_KEY, PW = process.env.SEED_PASSWORD;
for (const u of [BASE, API, PG_URL]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) { console.error(`Refusing to run against ${new URL(u).hostname}: local stack only.`); process.exit(2); }
}
if (!ANON || !PW) { console.error("Set ANON_KEY and SEED_PASSWORD (local test values)."); process.exit(2); }

const P01 = "aaaaaaaa-0000-0000-0000-000000000001", P02 = "aaaaaaaa-0000-0000-0000-000000000002";
const T_ARAF = "bbbbbbbb-0000-0000-0000-000000000201", T_ARIF = "bbbbbbbb-0000-0000-0000-000000000202", T_MASRUR = "bbbbbbbb-0000-0000-0000-000000000103";
const NEW_PW = "E2e-New-Passw0rd-2026";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const HTML = Buffer.from("<!doctype html><script>alert('not a photo')</script>");
const db = new pg.Client({ connectionString: PG_URL }); await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const uid = Object.fromEntries((await q("select login_name, id from profiles")).map((r) => [r.login_name, r.id]));

const results = [];
const check = (name, ok, extra = "") => { results.push(Boolean(ok)); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  — ${extra}` : ""}`); };
const token = async (user, password = PW) => (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON }, body: JSON.stringify({ email: `${user}@fsmb.local`, password }) })).json()).access_token;
const api = async (user, password = PW) => createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${await token(user, password)}` } } });
const fn = async (name, body, bearer) => {
  const r = await fetch(`${API}/functions/v1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
const cspErrors = [];
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  page.on("console", (m) => { if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(m.text())) cspErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 160)}`); });
  return page;
}
async function signIn(page, identifier, password = PW, query = "") {
  await page.goto(`${BASE}/login${query}`); await page.waitForLoadState("networkidle");
  await page.fill("#identifier", identifier); await page.fill("#password", password);
  await page.click("button[type=submit]");
  return page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).then(() => true, () => false);
}
const go = async (page, path) => { const r = await page.goto(`${BASE}${path}`); await page.waitForLoadState("networkidle"); return r; };
const at = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };

try {
  console.log("--- SEC-17: security headers and CSP ---");
  const res = await fetch(`${BASE}/login`);
  const h = (k) => res.headers.get(k) ?? "";
  check("Every response carries nosniff, a referrer policy, X-Frame-Options and a permissions policy", h("x-content-type-options") === "nosniff" && h("referrer-policy") === "strict-origin-when-cross-origin" && h("x-frame-options") === "DENY" && h("permissions-policy").includes("camera=()"));
  check("A Content-Security-Policy with a per-request nonce, no unsafe-inline scripts, no eval, frame-ancestors 'none'", /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'(;|$)/.test(h("content-security-policy")) && h("content-security-policy").includes("frame-ancestors 'none'") && !h("content-security-policy").includes("unsafe-eval"), h("content-security-policy").slice(0, 90));
  const nonce1 = /nonce-([A-Za-z0-9+/=]+)/.exec(h("content-security-policy"))?.[1], nonce2 = /nonce-([A-Za-z0-9+/=]+)/.exec((await fetch(`${BASE}/login`)).headers.get("content-security-policy") ?? "")?.[1];
  check("The nonce changes on every request", Boolean(nonce1) && nonce1 !== nonce2);
  const asset = await fetch(`${BASE}/_next/static/chunks/webpack.js`).catch(() => null);
  check("Static files carry nosniff too", (await fetch(`${BASE}/favicon.ico`)).headers.get("x-content-type-options") === "nosniff" || asset?.headers.get("x-content-type-options") === "nosniff");
  const admin = await open(); check("Admin signs in under the CSP", await signIn(admin, "rashidul"));
  for (const path of ["/dashboard/admin", "/dashboard/department", "/dashboard/projects", "/projects", `/projects/${P01}`, `/projects/${P01}/tasks`, `/projects/${P01}/tasks/${T_MASRUR}`, `/projects/${P01}/daily-reports`, `/projects/${P01}/members`, `/projects/${P01}/report`, `/projects/${P01}/settings`, "/performance", "/notifications", "/admin/users", "/admin/settings", "/admin/log", "/settings", "/help"]) await go(admin, path);
  await go(admin, "/admin/users"); await admin.getByRole("button", { name: "Add user" }).click(); await admin.getByRole("dialog").waitFor(); await admin.keyboard.press("Escape");
  const eng0 = await open(); await signIn(eng0, "imam");
  for (const path of ["/dashboard", "/my-tasks", "/daily-reports", "/daily-reports/new", "/my-performance"]) await go(eng0, path);
  check("The app's pages, dialogs, charts and forms raise no CSP violation", cspErrors.length === 0, cspErrors.slice(0, 3).join(" || "));
  const injected = await eng0.evaluate(() => new Promise((resolve) => {
    // what an XSS payload would be: markup with an inline event handler, eval, and a call home
    document.body.insertAdjacentHTML("beforeend", '<img src="data:image/png;base64,AAAA" onerror="window.__handlerRan = true">');
    setTimeout("window.__evalRan = true", 0);      // string-to-code, as eval would be (run by the page, not by the test driver)
    const i = document.createElement("img");
    const done = (img) => setTimeout(() => resolve({ handlerRan: Boolean(window.__handlerRan), evalBlocked: !window.__evalRan, img }), 500);
    i.onerror = () => done("blocked"); i.onload = () => done("loaded"); i.src = "https://example.com/pixel.png";
    setTimeout(() => done("timeout"), 4000);
  }));
  check("The CSP blocks injected inline handlers, eval and requests to other sites", injected.handlerRan === false && injected.evalBlocked === true && injected.img !== "loaded", JSON.stringify(injected));
  cspErrors.length = 0;
  await eng0.context().close();

  console.log("--- SEC-9: redirects and sign-out ---");
  for (const [next, label] of [["//evil.example", "//host"], ["/%5Cevil.example", "/\\host"], ["https://evil.example/x", "absolute URL"], ["/auth/signout", "/auth/signout"]]) {
    const p = await open();
    const ok = await signIn(p, "imam", PW, `?next=${encodeURIComponent(decodeURIComponent(next))}`);
    check(`Sign-in with next=${label} stays in the app, on the landing page`, ok && new URL(p.url()).origin === BASE && new URL(p.url()).pathname === "/dashboard", p.url());
    await p.context().close();
  }
  const pn = await open();
  check("Sign-in with a real in-app next still goes there", (await signIn(pn, "imam", PW, `?next=${encodeURIComponent(`/projects/${P01}/tasks`)}`)) && at(pn) === `/projects/${P01}/tasks`, at(pn));
  const cb = await pn.request.get(`${BASE}/auth/callback?next=//evil.example&code=not-a-real-code`, { maxRedirects: 0 });
  check("The email-link callback never redirects off-site", cb.status() >= 300 && cb.status() < 400 && new URL(cb.headers().location, BASE).origin === BASE, cb.headers().location);
  const g = await pn.request.get(`${BASE}/auth/signout`, { maxRedirects: 0 });
  await go(pn, "/dashboard");
  check("REGRESSION: GET /auth/signout no longer signs anyone out", g.status() === 303 && at(pn) === "/dashboard", `HTTP ${g.status()}, then ${at(pn)}`);
  const x = await pn.request.post(`${BASE}/auth/signout`, { headers: { origin: "https://evil.example" }, maxRedirects: 0 });
  await go(pn, "/dashboard");
  check("A sign-out POST from another site is refused and the session survives", x.status() === 403 && at(pn) === "/dashboard", `HTTP ${x.status()}`);
  await pn.locator("header button").last().click();
  await pn.getByRole("button", { name: "Sign out" }).click();
  await pn.waitForURL((u) => u.pathname === "/login");
  await go(pn, "/dashboard");
  check("The menu's Sign out (same-site POST) still works", new URL(pn.url()).pathname === "/login", at(pn));
  await pn.context().close();

  console.log("--- SEC-14: uploads ---");
  const arafApi = await api("araf");
  const { data: reportId, error: rErr } = await arafApi.rpc("save_daily_report", { p: { project_id: P02, update_text: "Photos of the rig" } });
  if (rErr) throw new Error(rErr.message);
  const araf = await open(); await signIn(araf, "araf");
  await go(araf, `/daily-reports/${reportId}`);
  const objects = async () => (await one("select count(*)::int n from storage.objects where name like $1", [`${P02}/${reportId}/%`])).n;
  const rows = () => q("select file_name, mime_type, size_bytes, storage_path from daily_report_attachments where report_id = $1 order by uploaded_at", [reportId]);
  await araf.setInputFiles("#report-files", { name: "rig-photo.png", mimeType: "image/png", buffer: PNG });
  await araf.getByRole("button", { name: "Remove rig-photo.png" }).waitFor({ timeout: 30000 }).catch(() => {});
  let r = await rows();
  check("A genuine photo uploads and is attached with its real type and size", r.length === 1 && r[0].mime_type === "image/png" && r[0].size_bytes === PNG.length && (await objects()) === 1, JSON.stringify(r[0] ?? null));
  await araf.setInputFiles("#report-files", { name: "holiday.jpg", mimeType: "image/jpeg", buffer: HTML });
  await araf.getByText(/isn't a valid photo/).first().waitFor({ timeout: 30000 }).catch(() => {});
  r = await rows();
  check("REGRESSION: an HTML page renamed to .jpg is refused, not attached, and removed from Storage", (await araf.getByText(/isn't a valid photo/).count()) > 0 && r.length === 1 && (await objects()) === 1, `rows ${r.length}, objects ${await objects()}`);
  check("…and no 'Files added' success is shown for it", (await araf.getByText(/^Files? added$|files added$/).count()) <= 1);
  // direct API abuse: upload a real object, then record it with a false type and size
  const path2 = `${P02}/${reportId}/eeeeeeee-0000-4000-8000-0000000000aa-second.png`;
  const up = await arafApi.storage.from("daily-report-files").upload(path2, PNG, { contentType: "image/png" });
  const ins = await arafApi.from("daily_report_attachments").insert({ report_id: reportId, storage_path: path2, file_name: "second.png", mime_type: "application/pdf", size_bytes: 1 }).select();
  r = await rows();
  check("Direct API: a false type and size are replaced by the stored file's own", !up.error && !ins.error && r.length === 2 && r[1].mime_type === "image/png" && r[1].size_bytes === PNG.length, ins.error?.message ?? JSON.stringify(r[1]));
  const ghost = await arafApi.from("daily_report_attachments").insert({ report_id: reportId, storage_path: `${P02}/${reportId}/eeeeeeee-0000-4000-8000-0000000000bb-ghost.png`, file_name: "ghost.png", mime_type: "image/png", size_bytes: 10 }).select();
  check("Direct API: an attachment for a file that was never uploaded is refused", Boolean(ghost.error), ghost.error?.message);
  const bad = await arafApi.storage.from("daily-report-files").upload(`${P02}/${reportId}/eeeeeeee-0000-4000-8000-0000000000cc-x.html`, HTML, { contentType: "text/html" });
  check("Storage refuses a type outside the list", Boolean(bad.error), bad.error?.message);
  const arifApi = await api("arif");
  const foreign = await arifApi.storage.from("daily-report-files").upload(`${P02}/${reportId}/eeeeeeee-0000-4000-8000-0000000000dd-x.png`, PNG, { contentType: "image/png" });
  check("A colleague cannot upload into someone else's report", Boolean(foreign.error), foreign.error?.message);
  await db.query("update workspace_settings set attachment_max_files = 2 where id = 1");
  const over = await arafApi.storage.from("daily-report-files").upload(`${P02}/${reportId}/eeeeeeee-0000-4000-8000-0000000000ee-third.png`, PNG, { contentType: "image/png" });
  check("REGRESSION: Storage refuses an upload beyond the per-report limit", Boolean(over.error) && (await objects()) === 2, over.error?.message);
  await db.query("update workspace_settings set attachment_max_files = 10 where id = 1");
  // failure-safe deletion
  const pmPage = await open(); await signIn(pmPage, "abrar");
  await go(pmPage, `/daily-reports/${reportId}`);
  check("A manager is no longer offered an upload Storage would refuse", (await pmPage.locator("#report-files").count()) === 0 && (await pmPage.getByText("rig-photo.png").count()) > 0);
  const masrurApi = await api("masrur");
  const att = await one("select id, storage_path from daily_report_attachments where report_id = $1 and file_name = 'rig-photo.png'", [reportId]);
  await masrurApi.from("daily_report_attachments").delete().eq("id", att.id);
  await masrurApi.storage.from("daily-report-files").remove([att.storage_path]);
  check("Someone with no access can delete neither the row nor the file", (await rows()).length === 2 && (await objects()) === 2);
  await go(araf, `/daily-reports/${reportId}`);
  araf.once("dialog", (d) => d.accept());
  await araf.getByRole("button", { name: "Remove rig-photo.png" }).click();
  await araf.getByText("File removed").first().waitFor({ timeout: 30000 }).catch(() => {});
  check("The author removes a file: the row and the stored file both go", (await rows()).length === 1 && (await objects()) === 1, `rows ${(await rows()).length}, objects ${await objects()}`);
  await pmPage.context().close(); await araf.context().close();

  console.log("--- SEC-4: deadline and extension audit ---");
  const abrarApi = await api("abrar");
  const before = await one("select effective_due_at from tasks where id = $1", [T_ARIF]);
  const due = new Date(Date.now() + 9 * 864e5).toISOString();
  let e = await abrarApi.from("tasks").update({ extended_deadline: due }).eq("id", T_ARIF).select();
  check("REGRESSION: a PM cannot set an extended deadline without an extension record (API)", Boolean(e.error), e.error?.message);
  e = await abrarApi.from("tasks").update({ assigned_on: "2026-01-01T00:00:00Z" }).eq("id", T_ARIF).select();
  check("REGRESSION: a PM cannot rewrite the assignment time that drives deadlines and scores (API)", Boolean(e.error), e.error?.message);
  e = await abrarApi.from("task_extensions").insert({ task_id: T_ARIF, new_deadline: due, reason: "Supplier delay", granted_by: uid.rashidul, granted_at: "2020-01-01T00:00:00Z", previous_deadline: "2020-01-01T00:00:00Z", source: "excel_import" }).select();
  const ext = await one("select granted_by, granted_at > now() - interval '1 minute' recent, source, previous_deadline from task_extensions where task_id = $1 order by id desc limit 1", [T_ARIF]);
  check("An extension record written with forged details carries the real grantor, time, source and previous deadline", !e.error && ext.granted_by === uid.abrar && ext.recent && ext.source === "app" && new Date(ext.previous_deadline).getTime() === new Date(before.effective_due_at).getTime(), e.error?.message ?? JSON.stringify(ext));
  const log = await one("select details, actor_user_id, ts > now() - interval '1 minute' recent from activity_log where task_id = $1 and action = 'Extension granted' order by id desc limit 1", [T_ARIF]);
  check("Audit log: who, when, previous → new deadline, reason", log?.actor_user_id === uid.abrar && log.recent && /^Deadline extended from .+ to .+Supplier delay$/.test(log.details), log?.details);
  await go(admin, `/projects/${P02}/log`);
  check("The project log shows the entry to managers", (await admin.locator("main").innerText()).includes("Deadline extended from"));
  const engExt = await (await api("arif")).from("task_extensions").insert({ task_id: T_ARIF, new_deadline: due }).select();
  check("An engineer cannot grant an extension (API)", Boolean(engExt.error), engExt.error?.message);

  console.log("--- SEC-5: forced password change ---");
  const arafPage = await open(); await signIn(arafPage, "araf");
  const staleToken = await token("araf");
  await db.query("update profiles set must_change_password = true where id = $1", [uid.araf]);
  await go(arafPage, "/dashboard");
  check("A session opened before the flag was set is sent to /change-password on its next page", at(arafPage) === "/change-password", at(arafPage));
  const stale = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${staleToken}` } } });
  const seen = await Promise.all(["projects", "tasks", "daily_reports", "notifications"].map(async (t) => (await stale.from(t).select("id")).data?.length ?? 0));
  const save = await stale.rpc("save_daily_report", { p: { project_id: P02, update_text: "bypass attempt" } });
  check("REGRESSION: with that token the API returns no data and refuses writes", seen.every((n) => n === 0) && Boolean(save.error), `rows ${seen.join("/")}, write: ${save.error?.message}`);
  await stale.from("profiles").update({ must_change_password: false }).eq("id", uid.araf);
  check("REGRESSION: the user cannot clear the flag through the API", (await one("select must_change_password m from profiles where id = $1", [uid.araf])).m === true);
  await arafPage.context().close();
  const fresh = await open();
  await signIn(fresh, "araf");
  check("Signing in lands on /change-password", at(fresh) === "/change-password", at(fresh));
  for (const path of ["/dashboard", `/projects/${P02}/tasks`, "/daily-reports/new", "/settings", "/notifications"]) {
    await go(fresh, path);
    if (at(fresh) !== "/change-password") { check(`Direct URL ${path} is redirected to /change-password`, false, at(fresh)); }
  }
  check("Direct URLs are all redirected to /change-password", at(fresh) === "/change-password");
  const act = await fresh.request.post(`${BASE}/dashboard`, { headers: { "next-action": "0".repeat(40), "content-type": "text/plain;charset=UTF-8", origin: BASE }, data: "[]", maxRedirects: 0 });
  check("REGRESSION: a Server Action post to another page is stopped by the middleware", act.status() === 307 && new URL(act.headers().location, BASE).pathname === "/change-password", `HTTP ${act.status()} → ${act.headers().location}`);
  await go(fresh, "/change-password");
  await fresh.fill("#password", NEW_PW); await fresh.fill("#confirm", NEW_PW); await fresh.click("button[type=submit]");
  await fresh.waitForURL((u) => u.pathname !== "/change-password", { timeout: 30000 }).catch(() => {});
  check("Changing the password clears the flag (in the database) and lets the user in", (await one("select must_change_password m from profiles where id = $1", [uid.araf])).m === false && at(fresh) === "/dashboard", at(fresh));
  await go(fresh, `/projects/${P02}/tasks`);
  check("…and the rest of the app is reachable straight away (fresh token)", at(fresh) === `/projects/${P02}/tasks`, at(fresh));
  await fresh.context().close();
  // an Admin sets someone's password: it is temporary
  const adminToken = await token("rashidul");
  const sp = await fn("auth-admin", { action: "set_password", user_id: uid.arif, password: "Admin-Chosen-Pass-1" }, adminToken);
  check("A password set by an Admin marks the account 'must change password'", sp.status === 200 && (await one("select must_change_password m from profiles where id = $1", [uid.arif])).m === true, `HTTP ${sp.status}`);
  const arifPage = await open(); await signIn(arifPage, "arif", "Admin-Chosen-Pass-1");
  check("…so that person must replace it at their next sign-in", at(arifPage) === "/change-password", at(arifPage));
  await arifPage.context().close();

  console.log("--- SEC-6: deactivated accounts ---");
  const mas = await open(); await signIn(mas, "masrur");
  const masToken = await token("masrur");
  await go(admin, "/admin/users");
  await admin.locator("tr", { hasText: "masrur@fsmb.local" }).getByRole("button", { name: "Edit" }).click();
  await admin.getByRole("dialog").getByLabel(/Account active/).uncheck();
  await admin.getByRole("dialog").getByRole("button", { name: "Save user" }).click();
  await admin.getByRole("dialog").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  const m1 = await one("select p.active, u.banned_until > now() banned from profiles p join auth.users u on u.id = p.id where p.id = $1", [uid.masrur]);
  check("An Admin deactivates a user in the app: the profile is inactive and the Auth account is blocked", m1.active === false && m1.banned === true, JSON.stringify(m1));
  let failed = null; mas.once("requestfailed", (rq) => { failed = rq.failure()?.errorText; });
  await mas.goto(`${BASE}/dashboard`).catch((err) => { failed = String(err).split("\n")[0]; }); await mas.waitForLoadState("networkidle").catch(() => {});
  check("REGRESSION: the deactivated user's open session ends on the sign-in page — no redirect loop", new URL(mas.url()).pathname === "/login" && !/TOO_MANY_REDIRECTS/.test(String(failed)) && (await mas.locator("form").innerText()).includes("Your account is inactive"), `${at(mas)} ${failed ?? ""}`);
  await go(mas, "/projects");
  check("…and is signed out (the next page asks to sign in)", at(mas).startsWith("/login?next="), at(mas));
  const old = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${masToken}` } } });
  const leak = await Promise.all(["projects", "tasks", "notifications", "notification_preferences", "activity_log"].map(async (t) => (await old.from(t).select("*")).data?.length ?? 0));
  check("REGRESSION: the old access token reads nothing, not even own notifications or log rows", leak.every((n) => n === 0), leak.join("/"));
  check("The deactivated user cannot sign in again", !(await signIn(mas, "masrur")), at(mas));
  const gl = await mas.request.get(`${BASE}/login?reason=inactive`, { maxRedirects: 0 });
  check("/login?reason=inactive is just the sign-in page for a signed-out visitor", gl.status() === 200);
  const imamPage = await open(); await signIn(imamPage, "imam");
  await go(imamPage, "/login?reason=inactive");
  check("A link to /login?reason=inactive does not sign an active user out", at(imamPage) === "/dashboard", at(imamPage));
  await imamPage.context().close();
  await admin.locator("tr", { hasText: "masrur@fsmb.local" }).getByRole("button", { name: "Edit" }).click();
  await admin.getByRole("dialog").getByLabel(/Account active/).check();
  await admin.getByRole("dialog").getByRole("button", { name: "Save user" }).click();
  await admin.getByRole("dialog").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  check("Reactivating restores sign-in", await signIn(mas, "masrur"), at(mas));
  await mas.context().close();

  console.log("--- SEC-3: demotion ---");
  const pm = await open(); await signIn(pm, "abrar");
  await go(pm, `/projects/${P02}/settings`);
  check("Before: the Project Manager reaches the project's manager-only Settings tab", at(pm) === `/projects/${P02}/settings` && (await pm.getByRole("link", { name: "Settings" }).count()) > 0);
  await go(admin, "/admin/users");
  await admin.locator("tr", { hasText: "abrar@fsmb.local" }).getByRole("button", { name: "Edit" }).click();
  await admin.getByRole("dialog").locator("#e-role").selectOption("engineer");
  await admin.getByRole("dialog").getByRole("button", { name: "Save user" }).click();
  await admin.getByRole("dialog").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  const mem = await one("select member_role from project_members where user_id = $1 and project_id = $2", [uid.abrar, P02]);
  check("An Admin demotes the PM to engineer in the app; their project role becomes engineer", (await one("select role from profiles where id = $1", [uid.abrar])).role === "engineer" && mem.member_role === "engineer", JSON.stringify(mem));
  const r404 = await go(pm, `/projects/${P02}/settings`);
  check("REGRESSION: the demoted user's open session loses the manager-only pages at once", r404.status() === 404 || (await pm.locator("main").innerText()).includes("isn't available"), `HTTP ${r404.status()}`);
  await go(pm, "/dashboard/projects");
  check("…and the My Projects dashboard", at(pm) !== "/dashboard/projects", at(pm));
  const d1 = await abrarApi.from("tasks").update({ priority: "Low" }).eq("id", T_ARIF).select();
  const d2 = await abrarApi.rpc("grant_extension", { p_task: T_ARIF, p_new_deadline: new Date(Date.now() + 20 * 864e5).toISOString(), p_reason: "after demotion" });
  const d3 = await abrarApi.rpc("set_task_deadline", { p_task: T_ARIF, p_due: new Date(Date.now() + 3 * 864e5).toISOString() });
  check("REGRESSION: with the token issued while still a PM, the API refuses manager actions", (Boolean(d1.error) || d1.data.length === 0) && Boolean(d2.error) && Boolean(d3.error), [d1.error?.message ?? `${d1.data?.length} rows`, d2.error?.message, d3.error?.message].join(" | "));
  await go(pm, `/projects/${P02}/tasks`);
  check("They still work in the project as a member", at(pm) === `/projects/${P02}/tasks` && (await pm.locator("main").innerText()).includes("P02-T0"));
  await pm.context().close();
  check("No CSP violation during any of the flows above", cspErrors.length === 0, cspErrors.slice(0, 3).join(" || "));
} catch (e) {
  check("script error", false, String(e.stack ?? e).split("\n").slice(0, 4).join(" | "));
} finally {
  await browser.close(); await db.end();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
