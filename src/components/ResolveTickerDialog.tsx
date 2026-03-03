import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeTicker } from "@/lib/ticker-resolution";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isin: string;
  name: string;
  mic?: string;
  onResolved: () => void;
}

export default function ResolveTickerDialog({ open, onOpenChange, isin, name, mic, onResolved }: Props) {
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const onSuggest = async () => {
    const { data, error } = await supabase.functions.invoke("resolve-asset-ticker", { body: { mode: "suggest", isin, name, mic } });
    if (error) {
      toast.error("Failed to fetch ticker suggestions");
      return;
    }
    const symbols = ((data?.suggestions || []) as any[]).map((item) => String(item.symbol || "").toUpperCase()).filter(Boolean).slice(0, 3);
    setSuggestions(symbols);
    if (data?.suggested) setTicker(normalizeTicker(String(data.suggested)));
  };

  const onApply = async () => {
    const cleanTicker = normalizeTicker(ticker);
    if (!cleanTicker) {
      toast.error("Ticker is required");
      return;
    }
    setBusy(true);
    const { error } = await supabase.functions.invoke("resolve-asset-ticker", {
      body: { mode: "apply", resolutions: [{ isin, ticker: cleanTicker, name, mic }] },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Resolved ${isin} to ${cleanTicker}`);
    onResolved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Resolve ticker</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm">{name}</p>
          <p className="text-xs text-muted-foreground">ISIN: {isin}</p>
          <Input value={ticker} onChange={(e) => setTicker(normalizeTicker(e.target.value))} placeholder="Ticker (required for pricing)" />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSuggest}>Suggest</Button>
            {suggestions.length > 0 && <p className="text-xs self-center">{suggestions.join(", ")}</p>}
          </div>
          <Button onClick={onApply} disabled={busy}>{busy ? "Resolving..." : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
