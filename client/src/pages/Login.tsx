import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ME_KEY } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderCircleIcon } from "lucide-react";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/login", { username, password });
      return res.json();
    },
    onSuccess: (user) => {
      // Seed the identity straight from the response, then let everything else
      // refetch now that requests will actually be authorised.
      queryClient.setQueryData(ME_KEY, user);
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      // apiRequest throws "401: {json}" — pull the human part back out.
      const match = err.message.match(/\{.*\}/);
      let message = "Something went wrong. Try again.";
      if (match) {
        try {
          message = JSON.parse(match[0]).message ?? message;
        } catch {
          /* fall through to the generic message */
        }
      }
      setError(message);
      setPassword("");
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (username && password) login.mutate();
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <svg aria-label="JobTrack logo" viewBox="0 0 36 36" fill="none" className="w-12 h-12 mb-3" xmlns="http://www.w3.org/2000/svg">
            <rect width="36" height="36" rx="8" fill="hsl(28 95% 52%)" />
            <rect x="9" y="10" width="18" height="3" rx="1.5" fill="hsl(220 14% 10%)" />
            <rect x="9" y="16.5" width="12" height="3" rx="1.5" fill="hsl(220 14% 10%)" />
            <rect x="9" y="23" width="15" height="3" rx="1.5" fill="hsl(220 14% 10%)" />
            <circle cx="26" cy="25" r="5" fill="hsl(220 14% 10%)" />
            <path d="M23.5 25l1.5 1.5L28 23" stroke="hsl(28 95% 52%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="font-display text-2xl font-bold tracking-tight">JobTrack</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={onSubmit} className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium">Username</Label>
            <Input
              id="username"
              data-testid="input-username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-secondary border-border text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">Password</Label>
            <Input
              id="password"
              data-testid="input-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-secondary border-border text-foreground"
            />
          </div>

          {error && (
            <p data-testid="text-login-error" role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <Button
            type="submit"
            data-testid="button-login"
            disabled={login.isPending || !username || !password}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold gap-2"
          >
            {login.isPending && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
            {login.isPending ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
