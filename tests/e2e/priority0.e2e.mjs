// Browser and API regression tests for the four Priority 0 fixes. LOCAL STACK ONLY: it writes reports and creates a
// user, so it refuses to run unless every address is on 127.0.0.1 / localhost. Never point it at production.
//
// Not part of `npm test` (the repo has no browser test runner). It needs, on this machine:
//   - a local database loaded with the migrations and seed.sql (freshly reset), reachable as PG_URL
//   - the Supabase API on API_URL, with the two Edge Functions of this repo running and these local test secrets:
//       SETUP_TOKEN = E2E_SETUP_TOKEN, LOGIN_RESOLVER_SECRET = E2E_RESOLVER_SECRET
//   - the built app on BASE_URL with LOGIN_RESOLVER_SECRET set to the same value, and a second instance on
//     EMAIL_ONLY_URL started with LOGIN_RESOLVER_SECRET empty
//   - packages playwright-core, pg and @supabase/supabase-js resolvable from where this file is run
//   - SEED_PASSWORD: the password of the local seed accounts
// Run:  node priority0.e2e.mjs
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL_ONLY = process.env.EMAIL_ONLY_URL ?? "http://localhost:3001";
const API = process.env.API_URL ?? "http://127.0.0.1:54321";
const PG_URL = process.env.PG_URL ?? "postgresql://postgres@127.0.0.1:54330/fsmb_local";
const ANON = process.env.ANON_KEY;
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN, RESOLVER_SECRET = process.env.E2E_RESOLVER_SECRET;
for (const u of [BASE, EMAIL_ONLY, API, PG_URL]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) { console.error(`Refusing to run against ${new URL(u).hostname}: local stack only.`); process.exit(2); }
}
if (!ANON || !SETUP_TOKEN || !RESOLVER_SECRET) { console.error("Set ANON_KEY, E2E_SETUP_TOKEN and E2E_RESOLVER_SECRET (local test values)."); process.exit(2); }
if (!process.env.SEED_PASSWORD) { console.error("Set SEED_PASSWORD to the local seed accounts' password."); process.exit(2); }

const PW = process.env.SEED_PASSWORD;            // the seed accounts' local password (see supabase/seed.sql)
const P01 = "aaaaaaaa-0000-0000-0000-000000000001", P02 = "aaaaaaaa-0000-0000-0000-000000000002";
const T_ARAF = "bbbbbbbb-0000-0000-0000-000000000201";
const db = new pg.Client({ connectionString: PG_URL }); await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const uid = Object.fromEntries((await q("select login_name, id from profiles")).map((r) => [r.login_name, r.id]));
const today = (await q("select to_char(app.dhaka_today(), 'YYYY-MM-DD') d"))[0].d;
const report = async (user, project, date = today) => (await q(
  `select r.id, r.update_text, r.remarks, (select count(*)::int from daily_report_items i where i.report_id = r.id) items,
          (select string_agg(i.status_after::text, ',') from daily_report_items i where i.report_id = r.id) statuses
     from daily_reports r where r.user_id = $1 and r.project_id = $2 and r.report_date = $3`, [uid[user], project, date]))[0] ?? null;

const results = [];
const check = (name, ok, extra = "") => { results.push(Boolean(ok)); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  — ${extra}` : ""}`); };
const fn = async (name, body, headers = {}) => {
  const r = await fetch(`${API}/functions/v1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const token = async (user) => (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON }, body: JSON.stringify({ email: `${user}@fsmb.local`, password: PW }) })).json()).access_token;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
async function open(base = BASE) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  return page;
}
async function signIn(page, identifier, password = PW, base = BASE) {
  await page.goto(`${base}/login`); await page.fill("#identifier", identifier); await page.fill("#password", password);
  await page.click("button[type=submit]");
  return page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).then(() => true, () => false);
}
const go = async (page, path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState("networkidle"); };
const editor = (page) => page.getByTestId("daily-row-editor");

try {
  console.log(`local stack · today ${today}\n--- Fix 4: sign-in ---`);
  let p = await open();
  check("Sign-in page offers 'Email or login name' when the resolver is configured", (await (await p.goto(`${BASE}/login`), p.locator("label[for=identifier]").innerText())) === "Email or login name");
  check("A login name signs in", await signIn(p, "araf"));
  await p.context().close(); p = await open();
  check("A login name in another case signs in", await signIn(p, "  ARAF "));
  await p.context().close(); p = await open();
  check("An email address signs in", await signIn(p, "araf@fsmb.local"));
  await p.context().close(); p = await open();
  check("A wrong password is refused with the generic message", !(await signIn(p, "araf", "wrong-password-1")) && (await p.locator("form").innerText()).includes("Email, login name or password is incorrect."));
  check("An unknown login name gets the same generic message", !(await signIn(p, "nobody-here")) && (await p.locator("form").innerText()).includes("Email, login name or password is incorrect."));
  check("An inactive account's login name gets the generic message", !(await signIn(p, "anik")) && (await p.locator("form").innerText()).includes("Email, login name or password is incorrect."));
  check("An invalid identifier gets the generic message", !(await signIn(p, "not a name!")) && (await p.locator("form").innerText()).includes("Email, login name or password is incorrect."));
  await p.context().close();
  let r = await fn("resolve-login", { login: "araf" });
  check("resolve-login refuses a caller with only the public key", r.status === 401 && !("email" in r.body), `HTTP ${r.status}`);
  r = await fn("resolve-login", { login: "araf" }, { Authorization: `Bearer ${await token("imam")}` });
  check("resolve-login refuses a signed-in user without the secret", r.status === 401 && !("email" in r.body), `HTTP ${r.status}`);
  r = await fn("resolve-login", { login: "araf" }, { "x-login-resolver-secret": "wrong-secret-0123456789abcdef" });
  check("resolve-login refuses a wrong secret", r.status === 401 && !("email" in r.body), `HTTP ${r.status}`);
  r = await fn("resolve-login", { login: "araf" }, { "x-login-resolver-secret": RESOLVER_SECRET });
  check("resolve-login answers the app server (right secret)", r.status === 200 && r.body.email === "araf@fsmb.local", `HTTP ${r.status}`);
  p = await open();
  await p.goto(`${EMAIL_ONLY}/login`); await p.waitForLoadState("networkidle");
  check("Without the secret on the server, the sign-in page asks for an email address only", (await p.locator("label[for=identifier]").innerText()) === "Email" && (await p.locator("#identifier").getAttribute("type")) === "email");
  await p.locator("form").evaluate((f) => f.setAttribute("novalidate", ""));   // get past the browser's own email check, to reach the server
  await p.fill("#identifier", "araf"); await p.fill("#password", PW); await p.click("button[type=submit]");
  await p.getByText("Sign in with the email address on your account.").waitFor({ timeout: 20000 }).catch(() => {});
  check("…and a login name is turned away with a clear message, not a silent failure", (await p.getByText("Sign in with the email address on your account.").count()) === 1 && new URL(p.url()).pathname === "/login");
  check("…while email sign-in still works there", await signIn(p, "araf@fsmb.local", PW, EMAIL_ONLY));
  await p.context().close();

  console.log("--- Fix 3: first-admin setup ---");
  const users = async () => (await q("select count(*)::int n from auth.users"))[0].n;
  const admins = async () => (await q("select count(*)::int n from profiles where role = 'admin'"))[0].n;
  const before = { users: await users(), admins: await admins() };
  const first = { action: "setup", email: "intruder@example.test", password: "a-long-password-1", full_name: "Intruder", login_name: "intruder" };
  r = await fn("auth-admin", first);
  check("setup with only the public key is refused", r.status === 403, `HTTP ${r.status}`);
  r = await fn("auth-admin", { ...first, setup_token: "guessed-setup-code-000000" });
  check("setup with a wrong setup code is refused", r.status === 403, `HTTP ${r.status}`);
  r = await fn("auth-admin", first, { Authorization: `Bearer ${await token("imam")}` });
  check("setup by a signed-in engineer is refused", r.status === 403, `HTTP ${r.status}`);
  r = await fn("auth-admin", { ...first, setup_token: SETUP_TOKEN });
  check("setup with the right code is still refused once an admin exists", r.status === 403 && /already complete/.test(r.body.message ?? ""), `HTTP ${r.status}`);
  r = await fn("auth-admin", { action: "invite", email: "x@example.test", full_name: "X", login_name: "x-admin", role: "admin", password: "a-long-password-1" }, { Authorization: `Bearer ${await token("imam")}` });
  check("an engineer cannot create an admin through invite", r.status === 403, `HTTP ${r.status}`);
  r = await fn("auth-admin", { action: "invite", email: "x@example.test", full_name: "X", login_name: "x-admin", role: "admin", password: "a-long-password-1" });
  check("a signed-out caller cannot invite", r.status === 401, `HTTP ${r.status}`);
  check("no account was created by any refused attempt", (await users()) === before.users && (await admins()) === before.admins);
  r = await fn("auth-admin", { action: "status" });
  check("status reports an admin exists", r.status === 200 && r.body.admin_exists === true);
  p = await open();
  const setupPage = await p.goto(`${BASE}/setup`);
  check("/setup is a 404 while an admin exists", setupPage.status() === 404, `HTTP ${setupPage.status()}`);
  // the intended, authorized path still works: an Admin creates a user in the app
  check("Admin signs in", await signIn(p, "rashidul"));
  await go(p, "/admin/users");
  await p.getByRole("button", { name: /add user|add a user/i }).first().click();
  const dlg = p.getByRole("dialog");
  await dlg.locator("#u-name").fill("E2E New Engineer");
  await dlg.locator("#u-login").fill("e2e.new");
  await dlg.locator("#u-email").fill("e2e.new@fsmb.local");
  await dlg.locator("#u-pw").fill("E2e-Password-12345");
  await dlg.locator("#u-pw2").fill("E2e-Password-12345");
  await dlg.locator("#u-dept").selectOption({ index: 1 });
  await dlg.getByRole("button", { name: /create/i }).click();
  await p.getByText(/User created successfully/).first().waitFor({ timeout: 30000 }).catch(() => {});
  const created = await q("select role, active, must_change_password from profiles where login_name = 'e2e.new'");
  check("Admin creates a user through the app (auth-admin invite still works)", created.length === 1 && created[0].active && created[0].must_change_password, JSON.stringify(created[0] ?? null));
  await p.context().close();

  console.log("--- Fix 1: a report keeps its task entry ---");
  const araf = await open(); await signIn(araf, "araf");
  await go(araf, `/daily-reports/new?project=${P02}`);
  await araf.getByLabel("Main Task").selectOption(T_ARAF);
  await araf.getByLabel("Daily Sub Task").fill("a. Accuracy run finished");
  await araf.getByLabel("Status").selectOption("Completed");
  await araf.getByRole("button", { name: "Submit daily update" }).click();
  await araf.waitForURL(/\/daily-reports\/[0-9a-f-]{36}$/); await araf.waitForLoadState("networkidle");
  let rep = await report("araf", P02);
  const taskStatus = async () => (await q("select status from tasks where id = $1", [T_ARAF]))[0].status;
  check("The engineer submits a report with a task and completes that task", rep?.items === 1 && (await taskStatus()) === "Completed", `items ${rep?.items}, task ${await taskStatus()}`);
  await go(araf, `/daily-reports/new?project=${P02}`);
  check("Reopened: the completed task is still shown as the report's Main Task", (await araf.getByLabel("Main Task").inputValue()) === T_ARAF && (await araf.locator("form").innerText()).includes("its entry stays in the update"));
  await araf.getByLabel("Daily Sub Task").fill("a. Accuracy run finished (typo fixed)");
  await araf.getByRole("button", { name: "Save today's update" }).click();
  await araf.waitForURL(/\/daily-reports\/[0-9a-f-]{36}$/); await araf.waitForLoadState("networkidle");
  rep = await report("araf", P02);
  check("REGRESSION: after reopening and saving, the task entry is still there", rep.items === 1 && rep.statuses === "Completed" && rep.update_text.includes("typo fixed"), `items ${rep.items}, statuses ${rep.statuses}`);
  check("…and the report page still shows the task and its status", /Completed/.test(await araf.locator("table tbody").innerText()));
  // the sheet's in-place editor: save an unrelated field
  await go(araf, `/projects/${P02}/daily-reports`);
  await araf.locator("tbody tr", { hasText: "typo fixed" }).getByRole("button", { name: "Edit" }).click(); await editor(araf).waitFor();
  check("Sheet editor: the completed task is still selected", (await editor(araf).getByLabel("Main Task").inputValue()) === T_ARAF);
  await editor(araf).getByLabel("Remarks").fill("Bench booked");
  await araf.getByRole("button", { name: "Save row" }).click(); await editor(araf).waitFor({ state: "detached" }); await araf.waitForLoadState("networkidle");
  rep = await report("araf", P02);
  check("Sheet editor: saving the remarks keeps the task entry", rep.items === 1 && rep.remarks === "Bench booked", `items ${rep.items}`);
  // Admin edits the same row (another person's report: the Admin path)
  const admin = await open(); await signIn(admin, "rashidul");
  await go(admin, `/projects/${P02}/daily-reports?from=${today}&to=${today}`);
  await admin.locator("tbody tr", { hasText: "typo fixed" }).getByRole("button", { name: "Edit" }).click(); await editor(admin).waitFor();
  await editor(admin).getByLabel("Issues").fill("Checked by Admin");
  await admin.getByRole("button", { name: "Save row" }).click(); await editor(admin).waitFor({ state: "detached" }); await admin.waitForLoadState("networkidle");
  rep = await report("araf", P02);
  check("Admin path: editing the row keeps the task entry", rep.items === 1 && rep.statuses === "Completed", `items ${rep.items}`);
  // explicit removal is still possible: the author clears the Main Task
  await go(araf, `/daily-reports/new?project=${P02}`);
  await araf.getByLabel("Main Task").selectOption("");
  await araf.getByRole("button", { name: "Save today's update" }).click();
  await araf.waitForURL(/\/daily-reports\/[0-9a-f-]{36}$/);
  rep = await report("araf", P02);
  check("Clearing the Main Task on purpose removes the entry (the only way it goes)", rep.items === 0, `items ${rep.items}`);
  await admin.context().close(); await araf.context().close();

  console.log("--- Fix 2: a draft never crosses projects ---");
  const imam = await open(); await signIn(imam, "imam");
  const p01Before = await report("imam", P01);
  await go(imam, `/daily-reports/new?project=${P02}`);
  await imam.evaluate(() => { window.__noReload = true; });
  await imam.getByLabel("Daily Sub Task").fill("DRAFT WRITTEN FOR P02");
  await imam.getByLabel("Issues").fill("P02 issue");
  await imam.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "P01" }).click();
  await imam.waitForURL((u) => u.search.includes(P01)); await imam.waitForLoadState("networkidle");
  check("Switching project happened without a full page reload", await imam.evaluate(() => window.__noReload === true));
  const shown = { text: await imam.getByLabel("Daily Sub Task").inputValue(), issues: await imam.getByLabel("Issues").inputValue() };
  check("REGRESSION: project B's form does not hold project A's draft", !shown.text.includes("DRAFT WRITTEN FOR P02") && shown.issues !== "P02 issue" && shown.text === p01Before.update_text, shown.text.slice(0, 40));
  await imam.getByRole("button", { name: /Save today's update|Submit daily update/ }).click();
  await imam.waitForURL(/\/daily-reports\/[0-9a-f-]{36}$/);
  const p01After = await report("imam", P01);
  check("Submitting after the switch saves this project's own text, not the other project's draft", p01After.update_text === p01Before.update_text && p01After.items === p01Before.items && p01After.id === p01Before.id, p01After.update_text.slice(0, 40));
  check("…and nothing was written to the project the draft was typed in", (await report("imam", P02)) === null);
  await go(imam, `/daily-reports/new?project=${P02}`);
  check("Back on the first project the form is fresh (the draft is gone, not silently kept)", (await imam.getByLabel("Daily Sub Task").inputValue()) === "");
  await imam.context().close();
  // a project id from the URL is not trusted: a non-member gets their own project, and the API refuses the id
  const masrur = await open(); await signIn(masrur, "masrur");
  await go(masrur, `/daily-reports/new?project=${P02}`);
  check("A non-member asking for another project's form gets their own project instead", (await masrur.locator("main").innerText()).includes("P01") && !(await masrur.locator("main").innerText()).includes("Robot Accuracy"));
  await masrur.context().close();
  const api = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${await token("masrur")}` } } });
  const refused = await api.rpc("save_daily_report", { p: { project_id: P02, update_text: "sent with another project's id" } });
  check("A manipulated project id is refused by the server", Boolean(refused.error) && (await report("masrur", P02)) === null, refused.error?.message);
} catch (e) {
  check("script error", false, String(e.stack ?? e).split("\n").slice(0, 4).join(" | "));
} finally {
  await browser.close(); await db.end();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
