import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/App";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Employee } from "@shared/schema";
import {
  LayoutDashboardIcon,
  UsersIcon,
  ActivityIcon,
  ChevronDownIcon,
  UserCircleIcon,
} from "lucide-react";

const AVATAR_COLORS = [
  "bg-orange-500", "bg-emerald-500", "bg-blue-500", "bg-purple-500",
  "bg-rose-500", "bg-amber-500", "bg-cyan-500", "bg-pink-500",
];

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { currentUser, setCurrentUser } = useCurrentUser();

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const activeEmployees = employees.filter((e) => e.active);

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
    { href: "/team", label: "Team", icon: UsersIcon },
    { href: "/activity", label: "Activity", icon: ActivityIcon },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          {/* Logo + Nav */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3 no-underline">
              <svg aria-label="JobTrack logo" viewBox="0 0 36 36" fill="none" className="w-8 h-8 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                <rect width="36" height="36" rx="8" fill="hsl(28 95% 52%)" />
                <rect x="9" y="10" width="18" height="3" rx="1.5" fill="hsl(220 14% 10%)" />
                <rect x="9" y="16.5" width="12" height="3" rx="1.5" fill="hsl(220 14% 10%)" />
                <rect x="9" y="23" width="15" height="3" rx="1.5" fill="hsl(220 14% 10%)" />
                <circle cx="26" cy="25" r="5" fill="hsl(220 14% 10%)" />
                <path d="M23.5 25l1.5 1.5L28 23" stroke="hsl(28 95% 52%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="font-display text-lg font-bold text-foreground leading-none tracking-tight hidden sm:block">
                JobTrack
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
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
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

          {/* Who Am I picker */}
          <div className="flex items-center gap-3">
            {activeEmployees.length === 0 ? (
              <Link href="/team">
                <span className="text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer">
                  + Add team members
                </span>
              </Link>
            ) : (
              <Select
                value={currentUser ? String(currentUser.id) : "none"}
                onValueChange={(val) => {
                  if (val === "none") {
                    setCurrentUser(null);
                  } else {
                    const emp = activeEmployees.find((e) => e.id === parseInt(val, 10));
                    if (emp) setCurrentUser(emp);
                  }
                }}
              >
                <SelectTrigger
                  data-testid="select-current-user"
                  className="w-auto min-w-[160px] bg-secondary border-border text-foreground text-sm h-9 gap-2"
                >
                  {currentUser ? (
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${currentUser.color}`}>
                        {getInitials(currentUser.name)}
                      </span>
                      <span className="truncate max-w-[120px]">{currentUser.name}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <UserCircleIcon className="w-4 h-4" />
                      <span>Select yourself</span>
                    </div>
                  )}
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No one selected</span>
                  </SelectItem>
                  {activeEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={String(emp.id)}>
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${emp.color}`}>
                          {getInitials(emp.name)}
                        </span>
                        {emp.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {children}
      </main>
    </div>
  );
}

export { AVATAR_COLORS, getInitials };
