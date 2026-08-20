import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ME_KEY } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderCircleIcon } from "lucide-react";
import { HLTBadge, FadeBar, Wordmark, CompanyLine } from "@/components/Brand";

/** Whose phone this is. Not a credential — just saves retyping it. */
const LAST_USER_KEY = "jobtrack.lastUsername";

export default function Login() {
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem(LAST_USER_KEY) ?? "";
    } catch {
      return ""; // private browsing, or storage disabled
    }
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/login", { username, password });
      return res.json();
    },
    onSuccess: (user) => {
      try {
        localStorage.setItem(LAST_USER_KEY, username);
      } catch {
        /* storage unavailable — the login still worked */
      }
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
    <div className="min-h-screen text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <HLTBadge className="w-16 h-16 mb-4" />
          <Wordmark className="text-3xl" />
          <div className="flex items-center gap-2 mt-2">
            <FadeBar className="h-[10px] w-[52px]" />
            <CompanyLine className="text-[10px]" />
          </div>
        </div>

        <form onSubmit={onSubmit} className="sheet-card p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="label-caps">Username</Label>
            <Input
              id="username"
              data-testid="input-username"
              autoComplete="username"
              autoFocus={username === ""}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-background border-border text-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="label-caps">Password</Label>
            <Input
              id="password"
              data-testid="input-password"
              type="password"
              autoComplete="current-password"
              autoFocus={username !== ""}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background border-border text-foreground"
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
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2 tracking-wide"
          >
            {login.isPending && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
            {login.isPending ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
