import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { type SymbolCandidate } from "@/lib/symbol-resolution";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: string;
  symbol: string;
  name: string;
  onResolved: () => void;
}

export default function ResolveTickerDialog({ open, onOpenChange, assetId, symbol, name, onResolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<SymbolCandidate[]>([]);
  const [selected, setSelected] = useState("");
  const [manualSymbol, setManualSymbol] = useState(symbol);

  const onSuggest = async () => {
    const { data, error } = await supabase.functions.invoke("resolve-symbol", { body: { symbol: manualSymbol } });
    if (error) {
      toast.error("Failed to fetch symbol suggestions");
      return;
    }
    const list = ((data?.candidates || []) as SymbolCandidate[]).slice(0, 6);
    setCandidates(list);
    setSelected(list[0]?.price_symbol || "");
  };

  const onApply = async () => {
    setBusy(true);
    const candidate = candidates.find((item) => item.price_symbol === selected) || null;
    const { error } = await supabase.rpc("set_asset_resolution", {
      _asset_id: assetId,
      _price_symbol: candidate?.price_symbol ?? manualSymbol.toUpperCase().trim(),
      _exchange_code: candidate?.exchange_code ?? null,
      _status: candidate ? "resolved" : "ambiguous",
      _notes: candidate ? null : "manual symbol fix",
    } as any);
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Symbol resolution saved");
    onResolved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Fix symbol</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm">{name}</p>
          <Input value={manualSymbol} onChange={(e) => setManualSymbol(e.target.value.toUpperCase())} placeholder="Ticker" />
          <Button variant="outline" onClick={onSuggest}>Find listings</Button>
          {candidates.length > 0 && (
            <div className="space-y-1">
              {candidates.map((candidate) => (
                <label key={candidate.price_symbol} className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={selected === candidate.price_symbol} onChange={() => setSelected(candidate.price_symbol)} />
                  <span>{candidate.price_symbol} · {candidate.currency || "n/a"} · {candidate.name}</span>
                </label>
              ))}
            </div>
          )}
          <Button onClick={onApply} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
