import { useState, createContext, useContext } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "./pages/Dashboard";
import JobDetail from "./pages/JobDetail";
import TeamPage from "./pages/TeamPage";
import ActivityPage from "./pages/ActivityPage";
import NotFound from "./pages/not-found";
import type { Employee } from "@shared/schema";

// ── Current User Context ──
// Persisted in React state (not localStorage, per sandbox rules)
interface UserCtx {
  currentUser: Employee | null;
  setCurrentUser: (e: Employee | null) => void;
}
const UserContext = createContext<UserCtx>({ currentUser: null, setCurrentUser: () => {} });
export const useCurrentUser = () => useContext(UserContext);

function App() {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <UserContext.Provider value={{ currentUser, setCurrentUser }}>
        <div className="dark">
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/job/:id" component={JobDetail} />
              <Route path="/team" component={TeamPage} />
              <Route path="/activity" component={ActivityPage} />
              <Route component={NotFound} />
            </Switch>
          </Router>
          <Toaster />
        </div>
      </UserContext.Provider>
    </QueryClientProvider>
  );
}

export default App;
