import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { useBotStore } from "@/store/bot-store.ts";

export function PanicDialog() {
  const open = useBotStore((s) => s.panicOpen);
  const setOpen = useBotStore((s) => s.setPanicOpen);
  const panic = useBotStore((s) => s.panic);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Panic flatten</DialogTitle>
          <DialogDescription>
            Flatten every managed ticket now. Moonbags are left on for ATH unless you include them.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => panic(false)}>
            Flatten non-moonbags
          </Button>
          <Button variant="danger" onClick={() => panic(true)}>
            Include moonbags
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
