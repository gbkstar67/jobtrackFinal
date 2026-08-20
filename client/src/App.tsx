import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient, getQueryFn, ME_KEY } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "./pages/Dashboard";
import JobDetail from "./pages/JobDetail";
import TeamPage from "./pages/TeamPage";
import ActivityPage from "./pages/ActivityPage";
import Login from "./pages/Login";
import NotFound from "./pages/not-found";
import type { Employee } from "@shared/schema";

// ── Current User ──
// Identity comes from the server session, not from React state. The old
// UserContext held a who-am-I <Select> value that reset on every refresh, so
// createdBy silently became null and the activity log filled up with
// "Someone created job X". The server now reads the actor from req.user.
export function useCurrentUser(): Employee | null {
  const { data } = useQuery<Employee | null>({
    queryKey: ME_KEY,
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });
  return data ?? null;
}

function AuthenticatedApp() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/job/:id" component={JobDetail} />
        <Route path="/team" component={TeamPage} />
        <Route path="/activity" component={ActivityPage} />
        {/* Already signed in and pointed at /login: send them to the board. */}
        <Route path="/login" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </Router>
  );
}

function AuthGate() {
  const { data: user, isLoading } = useQuery<Employee | null>({
    queryKey: ME_KEY,
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });

  // Blank rather than a flash of the login form while the session check is
  // still in flight — otherwise every hard refresh flickers through it.
  if (isLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  return user ? <AuthenticatedApp /> : <Login />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark">
        <AuthGate />
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}

export default App;
