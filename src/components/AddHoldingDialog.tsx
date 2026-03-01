import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portfolioId: string;
  onAdded: () => void;
}

export default function AddHoldingDialog({ open, onOpenChange, portfolioId, onAdded }: Props) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("stock");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [costCurrency, setCostCurrency] = useState("SEK");
  const [exchange, setExchange] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!symbol.trim() || !name.trim() || !quantity || !avgCost) return;
    setLoading(true);

    // Upsert asset
    const { data: existingAsset } = await supabase
      .from("assets")
      .select("id")
      .eq("symbol", symbol.toUpperCase().trim())
      .single();

    let assetId: string;
    if (existingAsset) {
      assetId = existingAsset.id;
    } else {
      const { data: newAsset, error: assetErr } = await supabase
        .from("assets")
        .insert({
          symbol: symbol.toUpperCase().trim(),
          name: name.trim(),
          asset_type: assetType as any,
          exchange: exchange.trim() || null,
          currency: costCurrency,
        })
        .select("id")
        .single();
      if (assetErr || !newAsset) {
        toast.error(assetErr?.message || "Kunde inte skapa tillgång");
        setLoading(false);
        return;
      }
      assetId = newAsset.id;
    }

    const { error } = await supabase.from("holdings").insert({
      portfolio_id: portfolioId,
      asset_id: assetId,
      quantity: parseFloat(quantity),
      avg_cost: parseFloat(avgCost),
      cost_currency: costCurrency,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Innehav tillagt!");
      setSymbol("");
      setName("");
      setQuantity("");
      setAvgCost("");
      onOpenChange(false);
      onAdded();
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lägg till innehav</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Symbol</Label>
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="XAU, NEM, SLV" className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Namn</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold, Newmont, iShares Silver" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Typ</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Aktie</SelectItem>
                  <SelectItem value="etf">ETF</SelectItem>
                  <SelectItem value="fund">Fond</SelectItem>
                  <SelectItem value="metal">Metall</SelectItem>
                  <SelectItem value="other">Övrigt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Börs</Label>
              <Input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="NYSE, NASDAQ, OMX" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Antal</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="10" />
            </div>
            <div className="space-y-2">
              <Label>Snittpris</Label>
              <Input type="number" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} placeholder="2000" />
            </div>
            <div className="space-y-2">
              <Label>Valuta</Label>
              <Select value={costCurrency} onValueChange={setCostCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEK">SEK</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="hero" className="w-full" onClick={handleAdd} disabled={loading || !symbol.trim() || !name.trim()}>
            {loading ? "Lägger till…" : "Lägg till"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
