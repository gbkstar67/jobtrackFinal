import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ME_KEY } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HLTBadge, FadeBar, Wordmark, CompanyLine } from "@/components/Brand";
import { LoaderCircleIcon } from "lucide-react";

/**
 * Where an invited crew member sets their own password.
 *
 * Reached from a one-time link the owner generates in Settings. Without this
 * the only logins that can exist are the signup owner and whatever the seed
 * script created — so a new shop could add eight people and none could sign in.
 */
export default function AcceptInvite() {
  const token = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accept-invite", { token, email, password });
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(ME_KEY, user);
      queryClient.invalidateQueries();
      window.location.hash = "#/";
    },
    onError: (err: Error) => {
      const m = err.message.match(/\{.*\}/);
      let message = "That link didn't work.";
      if (m) { try { message = JSON.parse(m[0]).message ?? message; } catch { /* keep default */ } }
      setError(message);
    },
  });

  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = token && email && password.length >= 8 && !mismatch;

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

        <form
          onSubmit={(e) => { e.preventDefault(); setError(null); if (ready) accept.mutate(); }}
          className="sheet-card p-6 space-y-4"
        >
          <div>
            <h1 className="font-display text-lg font-extrabold uppercase tracking-widest">Set your password</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {token ? "Pick an email and password to sign in with." : "This link is missing its token."}
            </p>
          </div>

          <div className="space-y-2">
            <label className="label-caps" htmlFor="inv-email">Email</label>
            <Input id="inv-email" data-testid="input-invite-email" autoComplete="username" type="email"
                   value={email} onChange={(e) => setEmail(e.target.value)}
                   className="bg-background border-border" />
          </div>
          <div className="space-y-2">
            <label className="label-caps" htmlFor="inv-pw">Password</label>
            <Input id="inv-pw" data-testid="input-invite-password" type="password" autoComplete="new-password"
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   className="bg-background border-border" />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="space-y-2">
            <label className="label-caps" htmlFor="inv-pw2">Confirm</label>
            <Input id="inv-pw2" data-testid="input-invite-confirm" type="password" autoComplete="new-password"
                   value={confirm} onChange={(e) => setConfirm(e.target.value)}
                   className="bg-background border-border" />
            {mismatch && <p className="text-xs text-destructive">Those don't match.</p>}
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button type="submit" data-testid="button-accept-invite" disabled={!ready || accept.isPending}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide gap-2">
            {accept.isPending && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
            {accept.isPending ? "Setting up..." : "Set password and sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
