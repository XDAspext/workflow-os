"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const CANCELLABLE = new Set(["queued", "running", "waiting"]);

export function RunActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  if (!CANCELLABLE.has(status)) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        const res = await fetch(`/api/executions/${id}/cancel`, { method: "POST" });
        if (!res.ok) {
          toast.error("Could not cancel this run.");
          return;
        }
        toast.success("Run cancelled");
        router.refresh();
      }}
    >
      Cancel
    </Button>
  );
}
