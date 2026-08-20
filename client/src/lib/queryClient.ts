import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

/** Query key for the session check, shared by the auth gate and the 401 handler. */
export const ME_KEY = ["/api/me"] as const;

/**
 * A 401 from any route means the session went away — expired, or the server
 * restarted with a cleared session table. Drop the cached identity so the app
 * falls back to the login screen instead of sitting on stale data behind an
 * error toast.
 */
function handleUnauthorized() {
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
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    // Send the session cookie. Same-origin would cover the deployed app, but
    // API_BASE can point at a different port in dev, and a dropped cookie there
    // looks exactly like a broken login.
    credentials: "include",
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
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { credentials: "include" });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") return null;
      handleUnauthorized();
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

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
