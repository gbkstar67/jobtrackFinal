import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AVATAR_PIXELS, type Employee } from "@shared/schema";
import Avatar from "@/components/Avatar";
import { CameraIcon, Trash2Icon, LoaderCircleIcon } from "lucide-react";

/**
 * Resize and re-encode a picked image to a small square, in the browser.
 *
 * Phone cameras produce multi-megabyte photos; sending one untouched would be
 * slow on site and pointless for something rendered at 32px. Cropping to a
 * centred square here also means the server never has to decode an image.
 */
async function toSquareJpeg(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function AvatarUpload({ employee }: { employee: Employee }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/employees"] });

  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/employees/${employee.id}/avatar`),
    onSuccess: () => {
      refresh();
      toast({ title: "Photo removed" });
    },
    onError: () =>
      toast({ title: "Couldn't remove that photo", variant: "destructive" }),
  });

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await toSquareJpeg(file, AVATAR_PIXELS);
      await apiRequest("PUT", `/api/employees/${employee.id}/avatar`, { dataUrl });
      refresh();
      toast({ title: "Photo updated" });
    } catch {
      toast({
        title: "Couldn't use that photo",
        description: "Try a JPEG or PNG.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <Avatar employee={employee} className="w-14 h-14" textClassName="text-base" />
        {busy && (
          <span className="absolute inset-0 rounded-full bg-foreground/50 flex items-center justify-center">
            <LoaderCircleIcon className="w-5 h-5 animate-spin text-white" />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          data-testid={`button-avatar-upload-${employee.id}`}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
        >
          <CameraIcon className="w-3.5 h-3.5" />
          {employee.hasAvatar ? "Change photo" : "Add photo"}
        </button>

        {employee.hasAvatar && (
          <button
            type="button"
            data-testid={`button-avatar-remove-${employee.id}`}
            disabled={busy || remove.isPending}
            onClick={() => remove.mutate()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2Icon className="w-3.5 h-3.5" />
            Remove
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </div>
  );
}
