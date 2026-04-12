import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ResolveAsset {
  id?: string;
  symbol?: string | null;
  isin?: string | null;
  name?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: ResolveAsset | null;
  onResolved: () => void;
}

export default function ResolveTickerDialog({ open, onOpenChange, asset, onResolved }: Props) {
  const isin = String(asset?.isin || "").trim().toUpperCase();
  const name = String(asset?.name || "").trim();
  const symbol = String(asset?.symbol || "").trim();

  const status = isin
    ? "✔ Resolved (ISIN)"
    : name
      ? "⚠ Fallback (NAME)"
      : "⚠ Missing data";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asset identifier status</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p><strong>Name:</strong> {name || "—"}</p>
          <p><strong>ISIN:</strong> {isin || "—"}</p>
          <p><strong>Identifier:</strong> {symbol || "—"}</p>
          <p><strong>Status:</strong> {status}</p>
          <Button onClick={() => { onResolved(); onOpenChange(false); }}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
