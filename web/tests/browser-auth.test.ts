import { test, onTestFinished } from "vite-plus/test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Directory } from "../server/directory.js";
import { createService } from "../server/service.js";
import type {
  BrowserHandoff,
  BrowserSession,
  SavedAccount,
  SavedRoom,
} from "../shared/directory.js";

const password = "a long browser test password";
const roomCode = "1234567890abcdef1234567890abcdef";

test("anonymous browser sessions expire after 15 minutes while signed-in sessions last 30 days", async () => {
  let now = 100000;
  const directory = new Directory(undefined, () => now);
  onTestFinished(() => directory.close());
  const anonymous = directory.startBrowser();
  const signedIn = await directory.authenticateBrowser(
    directory.startBrowser().token,
    { username: "alice", password },
    true,
  );
  assert.ok(signedIn.cookieToken);
  now += 15 * 60000 - 1;
  assert.deepEqual(directory.browserSession(anonymous.token).accounts, []);
  now++;
  assert.throws(() => directory.browserSession(anonymous.token), /expired/);
  assert.equal(directory.browserUser(signedIn.cookieToken, signedIn.user.id).username, "alice");
  now += 30 * 86400000 - 15 * 60000 - 1;
  assert.equal(directory.browserUser(signedIn.cookieToken, signedIn.user.id).username, "alice");
  now++;
  assert.throws(() => directory.browserSession(signedIn.cookieToken), /expired/);
});

test("browser capacity reclaims the oldest anonymous session and preserves accounts and pending handoffs", async () => {
  let now = 100000;
  const directory = new Directory(undefined, () => now);
  onTestFinished(() => directory.close());
  const alice = await directory.authenticate({ username: "alice", password }, true);
  const roomId = directory.save(alice.user, { code: roomCode }, true);
  const authenticated = directory.importBrowser(directory.startBrowser().token, alice.token);
  assert.ok(authenticated.cookieToken);
  // This signed-in session expires before the new anonymous sessions, but must
  // still be retained when reclaiming a slot.
  now += 30 * 86400000 - 10 * 60000;
  const pendingBrowser = directory.startBrowser();
  const pending = directory.prepareBrowserHandoff(
    pendingBrowser.token,
    directory.createBrowserHandoff(alice.token, roomId).ticket,
    "",
  );
  now++;
  const oldestAnonymous = directory.startBrowser();
  let newestAnonymous = oldestAnonymous;
  for (let i = 0; i < 9997; i++) {
    now++;
    newestAnonymous = directory.startBrowser();
  }
  const admitted = directory.startBrowser();
  assert.equal(admitted.created, true);
  assert.throws(() => directory.browserSession(oldestAnonymous.token), /expired/);
  assert.deepEqual(directory.browserSession(newestAnonymous.token).accounts, []);
  assert.equal(directory.browserUser(authenticated.cookieToken, alice.user.id).id, alice.user.id);
  assert.equal(
    directory.confirmBrowserHandoff(pendingBrowser.token, pending.handoffId).user.id,
    alice.user.id,
  );
});

test("handoff creates a separate browser grant only after confirmation and rotates the cookie", async () => {
  const directory = new Directory();
  onTestFinished(() => directory.close());
  const alice = await directory.authenticate({ username: "alice", password }, true);
  const bob = await directory.authenticate({ username: "bob", password }, true);
  const roomId = directory.save(alice.user, { code: roomCode, name: "Friday" }, true);
  let browser = directory.startBrowser();
  const originalCookie = browser.token;
  const ticket = directory.createBrowserHandoff(alice.token, roomId);
  const preview = directory.prepareBrowserHandoff(browser.token, ticket.ticket, "");
  assert.equal(preview.confirmationRequired, true);
  assert.deepEqual(preview.room, { id: roomId, name: "Friday" });
  assert.equal(directory.browserSession(browser.token).accounts.length, 0);
  assert.throws(() => directory.browserUser(browser.token, alice.user.id), /signed-in/);
  const confirmed = directory.confirmBrowserHandoff(browser.token, preview.handoffId);
  assert.equal(confirmed.user.id, alice.user.id);
  assert.equal(confirmed.selected, roomId);
  assert.equal(confirmed.rooms[0].participant, directory.rooms(alice.user)[0].participant);
  assert.notEqual(confirmed.cookieToken, originalCookie);
  assert.equal(confirmed.csrf, browser.csrf);
  assert.throws(() => directory.browserSession(originalCookie), /expired/);
  browser = directory.startBrowser(confirmed.cookieToken);
  const imported = directory.importBrowser(browser.token, bob.token);
  browser = directory.startBrowser(imported.cookieToken);
  assert.equal(directory.browserUser(browser.token, alice.user.id).id, alice.user.id);
  assert.equal(directory.browserUser(browser.token, bob.user.id).id, bob.user.id);
  const next = directory.createBrowserHandoff(alice.token, roomId);
  assert.equal(
    directory.prepareBrowserHandoff(browser.token, next.ticket, alice.user.id).confirmationRequired,
    false,
  );
  const different = directory.createBrowserHandoff(alice.token, roomId);
  assert.equal(
    directory.prepareBrowserHandoff(browser.token, different.ticket, bob.user.id)
      .confirmationRequired,
    true,
  );
  directory.logoutBrowser(browser.token, alice.user.id);
  assert.equal(directory.browserSession(browser.token).accounts.length, 1);
  assert.equal(directory.browserUser(browser.token, bob.user.id).username, "bob");
  assert.equal(directory.user(alice.token).username, "alice");
  directory.logout(bob.token);
  assert.equal(directory.browserUser(browser.token, bob.user.id).username, "bob");
});

test("handoff is single-use, browser-bound and rejects expired or revoked native sessions", async () => {
  let now = 100000;
  const directory = new Directory(undefined, () => now);
  onTestFinished(() => directory.close());
  const alice = await directory.authenticate({ username: "alice", password }, true);
  const outsider = await directory.authenticate({ username: "outsider", password }, true);
  const roomId = directory.save(alice.user, { code: roomCode }, true);
  assert.throws(() => directory.createBrowserHandoff(outsider.token, roomId), /cannot open/);
  const browser = directory.startBrowser(),
    other = directory.startBrowser();
  const ticket = directory.createBrowserHandoff(alice.token, roomId);
  const pending = directory.prepareBrowserHandoff(browser.token, ticket.ticket, "");
  assert.throws(
    () => directory.prepareBrowserHandoff(other.token, ticket.ticket, ""),
    /already used/,
  );
  assert.throws(
    () => directory.confirmBrowserHandoff(other.token, pending.handoffId),
    /expired|completed/,
  );
  assert.equal(directory.browserSession(other.token).accounts.length, 0);
  const done = directory.confirmBrowserHandoff(browser.token, pending.handoffId);
  assert.ok(done.cookieToken);
  const authenticated = done.cookieToken;
  assert.throws(
    () => directory.confirmBrowserHandoff(authenticated, pending.handoffId),
    /completed/,
  );
  const expires = directory.createBrowserHandoff(alice.token, roomId);
  now += 60000;
  assert.throws(
    () => directory.prepareBrowserHandoff(authenticated, expires.ticket, alice.user.id),
    /expired/,
  );
  const pendingExpiry = directory.prepareBrowserHandoff(
    authenticated,
    directory.createBrowserHandoff(alice.token, roomId).ticket,
    alice.user.id,
  );
  now += 60000;
  assert.throws(
    () => directory.confirmBrowserHandoff(authenticated, pendingExpiry.handoffId),
    /expired/,
  );
  const beforeLogout = directory.createBrowserHandoff(alice.token, roomId);
  const beforeLogoutPending = directory.prepareBrowserHandoff(
    authenticated,
    directory.createBrowserHandoff(alice.token, roomId).ticket,
    alice.user.id,
  );
  directory.logout(alice.token);
  assert.throws(
    () => directory.prepareBrowserHandoff(authenticated, beforeLogout.ticket, alice.user.id),
    /expired/,
  );
  assert.throws(
    () => directory.confirmBrowserHandoff(authenticated, beforeLogoutPending.handoffId),
    /expired/,
  );
  assert.equal(directory.browserUser(authenticated, alice.user.id).id, alice.user.id);
});

test("HTTP browser auth has protected cookies, CSRF checks, per-tab accounts and no returned bearer", async () => {
  const origin = "https://test.invalid";
  const service = createService({ origin });
  service.server.listen(0, "127.0.0.1");
  await once(service.server, "listening");
  onTestFinished(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const bootstrap = await request("/api/browser/session");
  const initialCookie = bootstrap.headers.get("set-cookie")!;
  assert.match(initialCookie, /^__Host-sharestream-browser=[a-f0-9]{64};/);
  assert.match(initialCookie, /HttpOnly/);
  assert.match(initialCookie, /Secure/);
  assert.match(initialCookie, /SameSite=Strict/);
  assert.doesNotMatch(initialCookie, /Domain=/);
  const session = (await bootstrap.json()) as BrowserSession;
  assert.deepEqual(session.accounts, []);
  let cookie = initialCookie.split(";")[0];
  const browserHeaders = () => ({ Cookie: cookie, Origin: origin, "X-CSRF-Token": session.csrf });
  assert.equal(
    (
      await request(
        "/api/browser/register",
        "POST",
        { username: "alice", password },
        { Cookie: cookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/browser/register",
        "POST",
        { username: "alice", password },
        { Cookie: cookie, Origin: origin },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/browser/register",
        "POST",
        { username: "alice", password },
        { ...browserHeaders(), Origin: "https://foreign.invalid" },
      )
    ).status,
    403,
  );
  const registered = await request(
    "/api/browser/register",
    "POST",
    { username: "alice", password },
    browserHeaders(),
  );
  assert.equal(registered.status, 200);
  cookie = registered.headers.get("set-cookie")!.split(";")[0];
  assert.notEqual(cookie, initialCookie.split(";")[0]);
  const alice = (await registered.json()) as BrowserSession & {
    user: SavedAccount["user"];
    token?: string;
    cookieToken?: string;
  };
  assert.equal(alice.token, undefined);
  assert.equal(alice.cookieToken, undefined);
  assert.equal(alice.csrf, session.csrf);
  const staleBootstrap = await request("/api/browser/session", "GET", undefined, {
    Cookie: initialCookie.split(";")[0],
  });
  assert.equal(staleBootstrap.status, 401);
  assert.equal(staleBootstrap.headers.get("set-cookie"), null);
  const currentBootstrap = await request("/api/browser/session", "GET", undefined, {
    Cookie: cookie,
  });
  assert.equal(currentBootstrap.status, 200);
  assert.equal(currentBootstrap.headers.get("set-cookie"), null);
  const oldCookieRequest = await request("/api/rooms", "GET", undefined, {
    Cookie: initialCookie.split(";")[0],
    "X-ShareStream-Account": alice.user.id,
  });
  assert.equal(oldCookieRequest.status, 401);
  const bobNativeResponse = await request("/api/accounts/register", "POST", {
    username: "bob",
    password,
  });
  const bob = (await bobNativeResponse.json()) as SavedAccount;
  const imported = await request(
    "/api/browser/import",
    "POST",
    {},
    { ...browserHeaders(), Authorization: `Bearer ${bob.token}` },
  );
  assert.equal(imported.status, 200);
  cookie = imported.headers.get("set-cookie")!.split(";")[0];
  const importedData = (await imported.json()) as BrowserSession & {
    token?: string;
    cookieToken?: string;
  };
  assert.equal(importedData.accounts.length, 2);
  assert.equal(importedData.token, undefined);
  assert.equal(importedData.cookieToken, undefined);
  const aliceHeaders = () => ({ ...browserHeaders(), "X-ShareStream-Account": alice.user.id });
  const bobHeaders = () => ({ ...browserHeaders(), "X-ShareStream-Account": bob.user.id });
  assert.equal((await request("/api/rooms", "GET", undefined, browserHeaders())).status, 401);
  assert.equal(
    (
      await request(
        "/api/rooms",
        "POST",
        { code: roomCode },
        { Cookie: cookie, "X-ShareStream-Account": alice.user.id },
      )
    ).status,
    403,
  );
  const created = await request(
    "/api/rooms",
    "POST",
    { code: roomCode, name: "Friday" },
    aliceHeaders(),
  );
  assert.equal(created.status, 200);
  const createdData = (await created.json()) as { rooms: SavedRoom[]; selected: string };
  const bobRooms = (await (await request("/api/rooms", "GET", undefined, bobHeaders())).json()) as {
    rooms: SavedRoom[];
  };
  assert.equal(bobRooms.rooms.length, 0);
  const aliceRooms = (await (
    await request("/api/rooms", "GET", undefined, aliceHeaders())
  ).json()) as { rooms: SavedRoom[] };
  assert.equal(aliceRooms.rooms[0].id, createdData.selected);
  assert.equal(
    (await request("/api/browser/logout", "POST", { accountId: alice.user.id }, browserHeaders()))
      .status,
    200,
  );
  assert.equal((await request("/api/rooms", "GET", undefined, aliceHeaders())).status, 401);
  assert.equal((await request("/api/rooms", "GET", undefined, bobHeaders())).status, 200);
  assert.equal(
    (await request("/api/rooms", "GET", undefined, { Authorization: `Bearer ${bob.token}` }))
      .status,
    200,
  );
});

test("HTTP handoff racing redemption has one winner and reveals room credentials only after confirmation", async () => {
  const origin = "http://localhost:48101";
  const service = createService({ origin });
  service.server.listen(0, "127.0.0.1");
  await once(service.server, "listening");
  onTestFinished(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const alice = (await (
    await request("/api/accounts/register", { username: "alice", password })
  ).json()) as SavedAccount;
  const nativeHeaders = { Authorization: `Bearer ${alice.token}` };
  const room = (await (
    await request("/api/rooms", { code: roomCode, name: "Friday" }, nativeHeaders)
  ).json()) as { selected: string };
  const bootstrap = await request("/api/browser/session");
  assert.doesNotMatch(bootstrap.headers.get("set-cookie")!, /; Secure/);
  assert.match(bootstrap.headers.get("set-cookie")!, /^sharestream-browser=/);
  const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0];
  const browser = (await bootstrap.json()) as BrowserSession;
  const headers = { Cookie: cookie, Origin: origin, "X-CSRF-Token": browser.csrf };
  const ticket = (await (
    await request("/api/accounts/browser-handoffs", { roomId: room.selected }, nativeHeaders)
  ).json()) as { ticket: string; expiresIn: number };
  assert.equal(ticket.expiresIn, 60);
  assert.notEqual(ticket.ticket, alice.token);
  const responses = await Promise.all([
    request("/api/browser/handoffs/prepare", { ticket: ticket.ticket }, headers),
    request("/api/browser/handoffs/prepare", { ticket: ticket.ticket }, headers),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort((a, b) => a - b),
    [200, 410],
  );
  const prepared = (await responses
    .find((response) => response.status === 200)!
    .json()) as BrowserHandoff;
  assert.equal(prepared.confirmationRequired, true);
  assert.deepEqual(Object.keys(prepared.room).sort(), ["id", "name"]);
  assert.equal(
    (await request("/api/rooms", undefined, { ...headers, "X-ShareStream-Account": alice.user.id }))
      .status,
    401,
  );
  const confirmed = await request(
    "/api/browser/handoffs/confirm",
    { handoffId: prepared.handoffId },
    headers,
  );
  assert.equal(confirmed.status, 200);
  const authenticatedCookie = confirmed.headers.get("set-cookie")!.split(";")[0];
  const completed = (await confirmed.json()) as {
    rooms: SavedRoom[];
    token?: string;
    cookieToken?: string;
  };
  assert.equal(completed.rooms[0].code, roomCode);
  assert.equal(completed.token, undefined);
  assert.equal(completed.cookieToken, undefined);
  const replay = await request(
    "/api/browser/handoffs/confirm",
    { handoffId: prepared.handoffId },
    { ...headers, Cookie: authenticatedCookie },
  );
  assert.equal(replay.status, 410);
  const nextTicket = (await (
    await request("/api/accounts/browser-handoffs", { roomId: room.selected }, nativeHeaders)
  ).json()) as { ticket: string };
  const currentHeaders = { ...headers, Cookie: authenticatedCookie };
  const sameAccount = (await (
    await request(
      "/api/browser/handoffs/prepare",
      { ticket: nextTicket.ticket, accountId: alice.user.id },
      currentHeaders,
    )
  ).json()) as BrowserHandoff;
  assert.equal(sameAccount.confirmationRequired, false);
  const sameConfirmed = await request(
    "/api/browser/handoffs/confirm",
    { handoffId: sameAccount.handoffId },
    currentHeaders,
  );
  assert.equal(sameConfirmed.status, 200);
  assert.equal(sameConfirmed.headers.get("set-cookie"), null);
});
