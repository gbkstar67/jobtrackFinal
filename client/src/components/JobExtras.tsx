import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, invalidatePath } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isNative } from "@/lib/native";
import {
  PHOTO_MAX_EDGE, PHOTO_THUMB_EDGE,
  type JobPhoto, type JobContact, type JobNote, type Employee,
} from "@shared/schema";
import {
  CameraIcon, Trash2Icon, PhoneIcon, MailIcon, PlusIcon,
  LoaderCircleIcon, StickyNoteIcon, UsersIcon, ImageIcon,
} from "lucide-react";

/** Downscale to a max edge and re-encode. Returns a JPEG data URL. */
async function resize(file: File | Blob, maxEdge: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

// ══════════════════════════ PHOTOS ══════════════════════════

export function JobPhotos({ jobId }: { jobId: number }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<JobPhoto | null>(null);

  const { data: photos = [] } = useQuery<JobPhoto[]>({ queryKey: [`/api/jobs/${jobId}/photos`] });
  const refresh = () => invalidatePath(`/api/jobs/${jobId}/photos`);

  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/photos/${id}`),
    onSuccess: () => { refresh(); setLightbox(null); toast({ title: "Photo deleted" }); },
  });

  /** Both sizes are produced here: a 40-photo job must not pull 25MB of full
   *  frames just to draw a thumbnail strip on a truck's 4G connection. */
  const upload = async (file: File | Blob | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const [dataUrl, thumbUrl] = await Promise.all([
        resize(file, PHOTO_MAX_EDGE, 0.72),
        resize(file, PHOTO_THUMB_EDGE, 0.7),
      ]);
      await apiRequest("POST", `/api/jobs/${jobId}/photos`, { dataUrl, thumbUrl });
      refresh();
      toast({ title: "Photo added" });
    } catch {
      toast({ title: "Couldn't add that photo", variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** Native uses the Camera plugin — a real capability, not a file picker. */
  const shoot = async () => {
    if (!isNative()) return fileRef.current?.click();
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        quality: 80, resultType: CameraResultType.Uri,
        source: CameraSource.Prompt, correctOrientation: true,
      });
      if (!photo.webPath) return;
      upload(await (await fetch(photo.webPath)).blob());
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="sheet-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-extrabold text-sm uppercase tracking-widest flex items-center gap-2">
          <ImageIcon className="w-4 h-4" /> Photos
        </h2>
        <button
          type="button"
          data-testid="button-add-photo"
          onClick={shoot}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
        >
          {busy ? <LoaderCircleIcon className="w-3.5 h-3.5 animate-spin" /> : <CameraIcon className="w-3.5 h-3.5" />}
          {busy ? "Adding..." : "Add photo"}
        </button>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">No photos from site yet.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setLightbox(p)}
              className="aspect-square rounded-md overflow-hidden border border-border hover:border-primary"
            >
              <img src={`/api/photos/${p.id}/thumb`} alt={p.caption ?? "Site photo"}
                   loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
             onChange={(e) => upload(e.target.files?.[0])} />

      {lightbox && (
        <div
          role="dialog"
          className="fixed inset-0 z-50 bg-foreground/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={`/api/photos/${lightbox.id}/full`} alt={lightbox.caption ?? ""}
                 className="w-full rounded-md bg-card" />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-white/80">
                {new Date(lightbox.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </span>
              <div className="flex gap-4">
                <button type="button" onClick={() => remove.mutate(lightbox.id)}
                        className="flex items-center gap-1.5 text-xs text-white/80 hover:text-destructive">
                  <Trash2Icon className="w-3.5 h-3.5" /> Delete
                </button>
                <button type="button" onClick={() => setLightbox(null)} className="text-xs text-white/80">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════ CONTACTS ══════════════════════════

export function JobContacts({ jobId }: { jobId: number }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", phone: "", email: "" });

  const { data: contacts = [] } = useQuery<JobContact[]>({ queryKey: [`/api/jobs/${jobId}/contacts`] });
  const refresh = () => invalidatePath(`/api/jobs/${jobId}/contacts`);

  const add = useMutation({
    mutationFn: () => apiRequest("POST", "/api/contacts", { jobId, ...form }),
    onSuccess: () => { refresh(); setForm({ name: "", role: "", phone: "", email: "" }); setAdding(false); },
    onError: () => toast({ title: "Couldn't add that contact", variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/contacts/${id}`),
    onSuccess: refresh,
  });

  return (
    <div className="sheet-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-extrabold text-sm uppercase tracking-widest flex items-center gap-2">
          <UsersIcon className="w-4 h-4" /> Contacts
        </h2>
        <button type="button" data-testid="button-add-contact" onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
          <PlusIcon className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {contacts.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground/70">No GC, engineer or vendor saved for this job.</p>
      ) : (
        <div className="divide-y divide-border">
          {contacts.map((c) => (
            <div key={c.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.name}</p>
                {c.role && <p className="label-caps">{c.role}</p>}
                <div className="flex flex-wrap gap-3 mt-1">
                  {/* tel: and mailto: — one tap from a jobsite is the point */}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <PhoneIcon className="w-3 h-3" /> {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline truncate">
                      <MailIcon className="w-3 h-3" /> {c.email}
                    </a>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => remove.mutate(c.id)}
                      className="text-muted-foreground hover:text-destructive flex-shrink-0">
                <Trash2Icon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <form className="space-y-2 pt-2 border-t border-border"
              onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) add.mutate(); }}>
          <Input placeholder="Name *" data-testid="input-contact-name" value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-background border-border" />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Role (GC, engineer…)" value={form.role}
                   onChange={(e) => setForm({ ...form, role: e.target.value })} className="bg-background border-border" />
            <Input placeholder="Phone" value={form.phone} inputMode="tel"
                   onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-background border-border" />
          </div>
          <Input placeholder="Email" value={form.email} inputMode="email"
                 onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-background border-border" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} className="text-muted-foreground">Cancel</Button>
            <Button type="submit" disabled={!form.name.trim() || add.isPending}
                    className="bg-primary text-primary-foreground font-bold tracking-wide">Save</Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ══════════════════════════ FIELD NOTES ══════════════════════════

export function JobNotes({ jobId, employees }: { jobId: number; employees: Map<number, Employee> }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");

  const { data: notes = [] } = useQuery<JobNote[]>({ queryKey: [`/api/jobs/${jobId}/notes`] });
  const refresh = () => { invalidatePath(`/api/jobs/${jobId}/notes`); invalidatePath("/api/activity"); };

  const add = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notes", { jobId, body: body.trim() }),
    onSuccess: () => { refresh(); setBody(""); },
    onError: () => toast({ title: "Couldn't save that note", variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/notes/${id}`),
    onSuccess: refresh,
  });

  return (
    <div className="sheet-card p-5 space-y-4">
      <h2 className="font-display font-extrabold text-sm uppercase tracking-widest flex items-center gap-2">
        <StickyNoteIcon className="w-4 h-4" /> Field notes
      </h2>

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <Textarea
          data-testid="input-note-body"
          rows={2}
          placeholder="What happened on site today?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="bg-background border-border resize-none"
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!body.trim() || add.isPending}
                  className="bg-primary text-primary-foreground font-bold tracking-wide">
            Add note
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">Nothing logged yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {notes.map((n) => (
            <div key={n.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                <p className="label-caps mt-1">
                  {n.authorId ? employees.get(n.authorId)?.name ?? "Someone" : "Someone"} ·{" "}
                  {new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <button type="button" onClick={() => remove.mutate(n.id)}
                      className="text-muted-foreground hover:text-destructive flex-shrink-0">
                <Trash2Icon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
