import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logAuditAction } from "@/lib/audit";
import { pickBestCandidate, type SymbolCandidate } from "@/lib/symbol-resolution";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portfolioId: string;
  defaultCurrency: string;
  onAdded: () => void;
}

const assetTypes = ["stock", "etf", "fund", "metal", "crypto", "other"];

export default function AddHoldingDialog({ open, onOpenChange, portfolioId, defaultCurrency, onAdded }: Props) {
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("");
  const [assetType, setAssetType] = useState("stock");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [costCurrency, setCostCurrency] = useState(defaultCurrency || "USD");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<SymbolCandidate[]>([]);
  const [selectedPriceSymbol, setSelectedPriceSymbol] = useState("");

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.price_symbol === selectedPriceSymbol) || null,
    [candidates, selectedPriceSymbol],
  );

  const resolveSymbol = async (rawSymbol: string, currency: string) => {
    const { data, error } = await supabase.functions.invoke("resolve-symbol", {
      body: { symbol: rawSymbol, hint_currency: currency },
    });
    if (error) return { candidates: [] as SymbolCandidate[], error: error.message };
    return { candidates: ((data?.candidates || []) as SymbolCandidate[]).slice(0, 5), error: null };
  };

  const applyAssetResolution = async (assetId: string, candidate: SymbolCandidate | null, status: "resolved" | "ambiguous" | "invalid", notes?: string) => {
    const { error } = await supabase.rpc("set_asset_resolution", {
      _asset_id: assetId,
      _price_symbol: candidate?.price_symbol ?? null,
      _exchange_code: candidate?.exchange_code ?? null,
      _status: status,
      _notes: notes ?? null,
    } as any);
    if (error) {
      toast.error(`Could not persist symbol resolution: ${error.message}`);
    }
  };

  const handleAdd = async () => {
    const clean = symbol.toUpperCase().trim();
    const qty = Number(quantity);
    const avg = avgCost ? Number(avgCost) : 0;
    if (!clean || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(avg) || avg < 0) {
      toast.error("Provide symbol, quantity > 0, and avg cost >= 0.");
      return;
    }

    setLoading(true);
    const { data: existingAsset } = await supabase.from("assets").select("id,price_symbol,symbol_resolution_status").eq("symbol", clean).maybeSingle();
    let assetId = existingAsset?.id;

    if (!assetId) {
      const { data: createdAsset, error: assetError } = await supabase.from("assets").insert({
        symbol: clean,
        name: clean,
        exchange: exchange.trim() || null,
        asset_type: assetType as any,
        currency: costCurrency,
        metadata_json: { created_by: "manual-entry" },
      }).select("id").single();

      if (assetError || !createdAsset) {
        toast.error(assetError?.message || "Unable to create asset.");
        setLoading(false);
        return;
      }
      assetId = createdAsset.id;
    }

    const resolution = await resolveSymbol(clean, costCurrency);
    const autoPick = pickBestCandidate(resolution.candidates || []);
    let resolutionStatus: "resolved" | "ambiguous" | "invalid" = "invalid";

    if (selectedCandidate) {
      await applyAssetResolution(assetId, selectedCandidate, "resolved");
      resolutionStatus = "resolved";
    } else if (autoPick.status === "resolved" && autoPick.candidate) {
      await applyAssetResolution(assetId, autoPick.candidate, "resolved");
      resolutionStatus = "resolved";
    } else if ((resolution.candidates || []).length > 1) {
      setCandidates(resolution.candidates);
      setSelectedPriceSymbol(resolution.candidates[0]?.price_symbol || "");
      await applyAssetResolution(assetId, null, "ambiguous", "multiple candidates; user selection needed");
      toast.info("Select listing below to improve pricing reliability.");
      resolutionStatus = "ambiguous";
    } else {
      await applyAssetResolution(assetId, null, "invalid", "Could not resolve symbol");
      toast.warning("Could not resolve symbol. Please edit symbol or select exchange.");
    }

    const { data: existingHolding } = await supabase
      .from("holdings")
      .select("id,quantity,avg_cost")
      .eq("portfolio_id", portfolioId)
      .eq("asset_id", assetId)
      .maybeSingle();

    if (existingHolding) {
      const mergedQty = Number(existingHolding.quantity) + qty;
      const mergedCostBasis = (Number(existingHolding.quantity) * Number(existingHolding.avg_cost)) + (qty * avg);
      const mergedAvg = mergedQty > 0 ? mergedCostBasis / mergedQty : 0;

      const { error: mergeError } = await supabase
        .from("holdings")
        .update({ quantity: mergedQty, avg_cost: mergedAvg, cost_currency: costCurrency })
        .eq("id", existingHolding.id);

      if (mergeError) {
        toast.error(mergeError.message);
      } else {
        await logAuditAction("holding_merge", "portfolio", portfolioId, { symbol: clean, added_quantity: qty, resolution_status: resolutionStatus });
        toast.success("Position existed, so we merged it automatically.");
      }
    } else {
      const { error } = await supabase.from("holdings").insert({
        portfolio_id: portfolioId,
        asset_id: assetId,
        quantity: qty,
        avg_cost: avg,
        cost_currency: costCurrency,
      });
      if (error) toast.error(error.message);
      else {
        await logAuditAction("holding_add", "portfolio", portfolioId, { symbol: clean, quantity: qty, resolution_status: resolutionStatus });
        toast.success("Holding added.");
      }
    }

    setLoading(false);
    setSymbol("");
    setExchange("");
    setQuantity("");
    setAvgCost("");
    onOpenChange(false);
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add holding</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Symbol *</Label><Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="NEM" /></div>
            <div className="space-y-1"><Label>Exchange</Label><Input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="NYSE" /></div>
          </div>
          {candidates.length > 1 && (
            <div className="space-y-1">
              <Label>Select listing</Label>
              <Select value={selectedPriceSymbol} onValueChange={setSelectedPriceSymbol}>
                <SelectTrigger><SelectValue placeholder="Choose exchange listing" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.price_symbol} value={candidate.price_symbol}>
                      {candidate.price_symbol} · {candidate.currency || "n/a"} · {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Asset type</Label><Select value={assetType} onValueChange={setAssetType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assetTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Cost currency</Label><Input value={costCurrency} onChange={(e) => setCostCurrency(e.target.value.toUpperCase())} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Quantity *</Label><Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
            <div className="space-y-1"><Label>Average cost</Label><Input type="number" min="0" step="any" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} placeholder="Optional" /></div>
          </div>
          <Button onClick={handleAdd} disabled={loading}>{loading ? "Saving..." : "Save holding"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
