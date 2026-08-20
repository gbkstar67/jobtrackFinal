import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "@/App";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboardIcon,
  UsersIcon,
  ActivityIcon,
  LogOutIcon,
} from "lucide-react";
import { HLTBadge, FadeBar, Wordmark, CompanyLine } from "@/components/Brand";

const AVATAR_COLORS = [
  "bg-orange-500", "bg-emerald-500", "bg-blue-500", "bg-purple-500",
  "bg-rose-500", "bg-amber-500", "bg-cyan-500", "bg-pink-500",
];

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const currentUser = useCurrentUser();

  const logout = useMutation({
    mutationFn: () => apiRequest("POST", "/api/logout"),
    // clear() rather than invalidate(): nothing cached should outlive the
    // session, and the next user on this browser shouldn't see the last one's data.
    onSuccess: () => queryClient.clear(),
  });

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
    { href: "/team", label: "Team", icon: UsersIcon },
    { href: "/activity", label: "Activity", icon: ActivityIcon },
  ];

  return (
    <div className="min-h-screen text-foreground">
      {/* Header */}
      <header className="rule-blue bg-card/95 backdrop-blur-sm sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          {/* Logo + Nav */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3 no-underline group">
              <HLTBadge className="w-10 h-10 flex-shrink-0" />
              <span className="hidden sm:flex flex-col gap-1">
                <Wordmark className="text-xl" />
                <span className="flex items-center gap-2">
                  <FadeBar className="h-[9px] w-[46px]" />
                  <CompanyLine className="text-[9px]" />
                </span>
              </span>
            </Link>

            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? location === "/" || location === ""
                    : location.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <span
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors cursor-pointer ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-primary hover:bg-accent"
                      }`}
                    >
                      <item.icon className="w-4 h-4" />
                      <span className="hidden sm:inline">{item.label}</span>
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Signed-in user + sign out */}
          <div className="flex items-center gap-3">
            {currentUser && (
              <div data-testid="text-current-user" className="flex items-center gap-2">
                <span className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${currentUser.color}`}>
                  {getInitials(currentUser.name)}
                </span>
                <div className="hidden sm:block leading-tight">
                  <p className="text-sm font-medium text-foreground">{currentUser.name}</p>
                  {currentUser.role && (
                    <p className="text-xs text-muted-foreground">{currentUser.role}</p>
                  )}
                </div>
              </div>
            )}
            <Button
              data-testid="button-logout"
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              title="Sign out"
              className="text-muted-foreground hover:text-foreground gap-1.5"
            >
              <LogOutIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {children}
      </main>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 pb-8 pt-2 flex items-center gap-3">
        <FadeBar className="h-[10px] w-[52px]" color="hsl(var(--border))" />
        <CompanyLine className="text-[10px]" />
      </footer>
    </div>
  );
}

export { AVATAR_COLORS, getInitials };
