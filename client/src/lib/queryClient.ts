import { QueryClient, QueryFunction } from "@tanstack/react-query";

import { apiBase, isNative, platformHeaders } from "@/lib/native";

/**
 * Native authenticates with a bearer token, so credentials mode is "omit":
 * sending "include" cross-origin would require Access-Control-Allow-Credentials
 * on every response, and without it the browser discards the response as a
 * network error — every call failing with an opaque CORS message while curl
 * against the same server passes.
 */
const creds = (): RequestCredentials => (isNative() ? "omit" : "include");

/** Query key for the session check, shared by the auth gate and the 401 handler. */
export const ME_KEY = ["/api/me"] as const;

/**
 * A 401 from any route means the session went away — expired, or the server
 * restarted with a cleared session table. Drop the cached identity so the app
 * falls back to the login screen instead of sitting on stale data behind an
 * error toast.
 */
function handleUnauthorized() {
  // Clear EVERYTHING, not just the identity. Only wiping ME_KEY left every
  // other cached entry in place with staleTime: Infinity, so a session that
  // ended without an explicit Sign out — expiry, a redeploy, someone else
  // picking up the phone — rendered the previous company's jobs, team and
  // client details to whoever signed in next.
  queryClient.clear();
  queryClient.setQueryData(ME_KEY, null);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${apiBase()}${url}`, {
    method,
    headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...platformHeaders() },
    body: data ? JSON.stringify(data) : undefined,
    // Send the session cookie. Same-origin would cover the deployed app, but
    // API_BASE can point at a different port in dev, and a dropped cookie there
    // looks exactly like a broken login.
    credentials: creds(),
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Key parts join with "/" to build the path. A part carrying a query
    // string must therefore be the last one, or the "?" ends up mid-path —
    // which silently matches a /:id route instead of erroring.
    const path = queryKey.join("/");
    if (path.indexOf("?") !== -1 && path.indexOf("?") !== path.lastIndexOf("/") - 0 && /\?[^/]*\//.test(path)) {
      throw new Error(`Query key builds an invalid URL (params before a path segment): ${path}`);
    }
    const res = await fetch(`${apiBase()}${path}`, {
      credentials: creds(),
      headers: platformHeaders(),
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") return null;
      handleUnauthorized();
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * Invalidate every cached query whose URL starts with `path`.
 *
 * Query keys here are whole URLs, including any query string, because the
 * default queryFn joins key parts with "/". That means React Query's normal
 * prefix matching does NOT work: the key ["/api/tasks?view=today"] does not
 * start with ["/api/tasks"], so invalidating the latter silently matches
 * nothing and a completed task stays on screen. Match on the string instead.
 */
export function invalidatePath(path: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const first = query.queryKey[0];
      return typeof first === "string" && (first === path || first.startsWith(`${path}?`));
    },
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
