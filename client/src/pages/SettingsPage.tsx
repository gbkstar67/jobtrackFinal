import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, invalidatePath } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/App";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { registerForPush, isNative, isStandalone, nativePlatform } from "@/lib/native";
import type { Employee } from "@shared/schema";
import { BellIcon, SmartphoneIcon, CheckIcon, CopyIcon, UserPlusIcon } from "lucide-react";

interface PushStatus {
  web: boolean; apns: boolean; fcm: boolean;
  publicKey: string | null; myDevices: number;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const me = useCurrentUser();
  const [inviteLink, setInviteLink] = useState<{ name: string; link: string; purpose: string } | null>(null);

  const { data: push } = useQuery<PushStatus>({ queryKey: ["/api/push/status"] });
  const { data: company } = useQuery<{ id: number; name: string; ownerEmployeeId?: number }>({
    queryKey: ["/api/company"],
  });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const enable = useMutation({
    mutationFn: async () => {
      const ok = await registerForPush(push?.publicKey ?? null);
      if (!ok) throw new Error("denied");
      invalidatePath("/api/push/status");
    },
    onSuccess: () => toast({ title: "Notifications on for this device" }),
    onError: () =>
      toast({
        title: "Couldn't turn on notifications",
        description: isStandalone() || isNative()
          ? "Check notification permission in your phone's settings."
          : "On iPhone, add Jobdeck to your Home Screen first — Safari only allows notifications for installed apps.",
        variant: "destructive",
      }),
  });

  const test = useMutation({
    mutationFn: () => apiRequest("POST", "/api/push/test").then((r) => r.json()),
    onSuccess: (r: { sent: number }) =>
      toast({ title: r.sent ? "Test sent" : "Nothing delivered", description: `${r.sent} device(s)` }),
    onError: () => toast({ title: "No device registered yet", variant: "destructive" }),
  });

  const invite = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/employees/${id}/invite`).then((r) => r.json()),
    onSuccess: (r) => setInviteLink(r),
    onError: () => toast({ title: "Only the account owner can send invites", variant: "destructive" }),
  });

  const isOwner = company?.ownerEmployeeId === me?.id;
  const transports = push ? [push.web && "web", push.apns && "iPhone", push.fcm && "Android"].filter(Boolean) : [];

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight">Settings</h1>

      {/* Notifications */}
      <div className="sheet-card p-5 space-y-4">
        <h2 className="font-display font-extrabold text-sm uppercase tracking-widest flex items-center gap-2">
          <BellIcon className="w-4 h-4" /> Notifications
        </h2>
        <p className="text-sm text-muted-foreground">
          Reminders are sent to the person a task is assigned to. If nobody is assigned, everyone with
          notifications on gets it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            data-testid="button-enable-push"
            onClick={() => enable.mutate()}
            disabled={enable.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide gap-2"
          >
            <BellIcon className="w-4 h-4" />
            {push?.myDevices ? "Re-register this device" : "Turn on for this device"}
          </Button>
          {push?.myDevices ? (
            <>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckIcon className="w-4 h-4 text-primary" />
                {push.myDevices} device{push.myDevices === 1 ? "" : "s"} registered
              </span>
              <button
                type="button"
                data-testid="button-test-push"
                onClick={() => test.mutate()}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Send a test
              </button>
            </>
          ) : null}
        </div>
        {transports.length === 0 && (
          <p className="text-xs text-destructive">
            No push transport is configured on the server yet — reminders won't send.
          </p>
        )}
        {!isNative() && !isStandalone() && (
          <div className="rounded-md border border-border bg-secondary/60 p-3 text-xs text-muted-foreground flex gap-2">
            <SmartphoneIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              On iPhone, notifications only work once Jobdeck is on your Home Screen:
              tap Share, then <strong>Add to Home Screen</strong>, and open it from there.
            </span>
          </div>
        )}
      </div>

      {/* Crew logins */}
      <div className="sheet-card p-5 space-y-4">
        <h2 className="font-display font-extrabold text-sm uppercase tracking-widest flex items-center gap-2">
          <UserPlusIcon className="w-4 h-4" /> Crew logins
        </h2>
        {!isOwner ? (
          <p className="text-sm text-muted-foreground">Only the account owner can invite people.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Generate a link for someone to set their own password. The link works once and expires in 7 days.
            </p>
            <div className="divide-y divide-border">
              {employees.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.name}</p>
                    <p className="label-caps">{e.loginEmail ?? e.username ?? "No login yet"}</p>
                  </div>
                  <button
                    type="button"
                    data-testid={`button-invite-${e.id}`}
                    onClick={() => invite.mutate(e.id)}
                    className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                  >
                    {e.loginEmail || e.username ? "Reset link" : "Invite"}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {inviteLink && (
          <div className="rounded-md border-2 border-primary bg-accent/50 p-3 space-y-2">
            <p className="text-sm font-semibold">
              {inviteLink.purpose === "reset" ? "Password reset" : "Invite"} link for {inviteLink.name}
            </p>
            <code className="block break-all text-xs bg-card p-2 rounded border border-border">
              {window.location.origin}{inviteLink.link}
            </code>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(`${window.location.origin}${inviteLink.link}`);
                  toast({ title: "Copied" });
                }}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                <CopyIcon className="w-3.5 h-3.5" /> Copy
              </button>
              <button type="button" onClick={() => setInviteLink(null)} className="text-xs text-muted-foreground">
                Done
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Send it however you normally reach them. It can only be used once.
            </p>
          </div>
        )}
      </div>

      {/* About */}
      <div className="sheet-card p-5 space-y-1">
        <h2 className="font-display font-extrabold text-sm uppercase tracking-widest">About</h2>
        <p className="text-sm text-muted-foreground">{company?.name}</p>
        <p className="label-caps">
          {isNative() ? `Native · ${nativePlatform()}` : isStandalone() ? "Home screen app" : "Browser"}
          {" · build "}{String(__BUILD_NUMBER__)}
        </p>
      </div>
    </AppShell>
  );
}
