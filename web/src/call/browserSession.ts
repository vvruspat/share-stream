import type {
  Account,
  SavedAccount,
  SavedRoom,
  BrowserSession,
  BrowserHandoff,
} from "../../shared/directory.js";
export type { BrowserSession };
export type Handoff = BrowserHandoff;
export type DirectoryResponse = Partial<BrowserSession> & {
  user?: Account;
  rooms?: SavedRoom[];
  selected?: string;
  error?: string;
};
export class BrowserRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
let csrf = "";
const authLock = "sharestream:browser-session";
function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(authLock, action) : action();
}
export function refreshBrowserSession(): Promise<BrowserSession> {
  return withSessionLock(refreshSession);
}
async function refreshSession(): Promise<BrowserSession> {
  const request = () =>
    fetch("/api/browser/session", {
      credentials: "same-origin",
      signal: AbortSignal.timeout(10000),
    });
  let response = await request();
  // A concurrent tab may have rotated the shared cookie while this request was in flight.
  if (response.status === 401) response = await request();
  const result = (await response.json()) as BrowserSession & { error?: string };
  if (!response.ok)
    throw new BrowserRequestError(result.error || "Account service unavailable.", response.status);
  csrf = result.csrf;
  return result;
}
export async function browserRequest<T = DirectoryResponse>(
  path: string,
  method = "GET",
  body?: unknown,
  accountId?: string,
  legacyToken?: string,
  retry = true,
  locked = false,
): Promise<T> {
  if (path.startsWith("/api/browser/") && method !== "GET" && !locked)
    return withSessionLock(async () => {
      if (path !== "/api/browser/reset") await refreshSession();
      return browserRequest<T>(path, method, body, accountId, legacyToken, retry, true);
    });
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(accountId ? { "X-ShareStream-Account": accountId } : {}),
      ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const result = (await response.json()) as T & { error?: string; csrf?: string };
  if (response.status === 403 && retry && method !== "GET") {
    // Retry once after another tab changes the cookie in browsers without Web Locks.
    if (locked) await refreshSession();
    else await refreshBrowserSession();
    return browserRequest<T>(path, method, body, accountId, legacyToken, false, locked);
  }
  if (response.status === 401 && accountId && retry) {
    const session = await refreshBrowserSession();
    if (session.accounts.some((account) => account.id === accountId))
      return browserRequest<T>(path, method, body, accountId, legacyToken, false);
  }
  if (!response.ok)
    throw new BrowserRequestError(
      result.error || "Could not complete the request.",
      response.status,
    );
  if (result.csrf) csrf = result.csrf;
  return result;
}
const activeKey = "sharestream:active-account:v2";
export function activeBrowserAccount() {
  try {
    return sessionStorage.getItem(activeKey) || "";
  } catch {
    return "";
  }
}
export function rememberBrowserAccount(id: string) {
  try {
    sessionStorage.setItem(activeKey, id);
  } catch {
    /* This tab works without storage. */
  }
}
// Upgrade bridge only. New sessions are HttpOnly cookies, never JS bearer tokens.
export async function migrateBrowserAccounts(session: BrowserSession) {
  return withSessionLock(() => migrate(navigator.locks ? refreshSession() : session));
  async function migrate(input: BrowserSession | Promise<BrowserSession>) {
    const key = "sharestream:accounts:v1";
    type Legacy = { accounts?: SavedAccount[]; active?: string };
    let old: Legacy | null = null;
    try {
      old = JSON.parse(localStorage.getItem(key) || "null") as Legacy | null;
    } catch {
      /* Invalid or blocked legacy store. */
    }
    const pending = [...(Array.isArray(old?.accounts) ? old.accounts : [])];
    let current = await input;
    for (const account of pending.slice()) {
      if (!account?.user?.id || !/^[a-f0-9]{64}$/.test(account.token)) {
        pending.splice(pending.indexOf(account), 1);
        continue;
      }
      try {
        current = await browserRequest<BrowserSession>(
          "/api/browser/import",
          "POST",
          {},
          undefined,
          account.token,
          true,
          true,
        );
        pending.splice(pending.indexOf(account), 1);
      } catch (error) {
        if (error instanceof BrowserRequestError && error.status === 401)
          pending.splice(pending.indexOf(account), 1);
        else break;
      }
    }
    if (old) {
      try {
        if (!pending.length) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ accounts: pending, active: old.active }));
      } catch {
        /* No new credentials are written here. */
      }
      if (!activeBrowserAccount() && current.accounts.some((a) => a.id === old.active))
        rememberBrowserAccount(old.active!);
    }
    return current;
  }
}
