import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type TradeType = "buy" | "sell" | "adjust" | "remove";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portfolioId: string;
  type: TradeType;
  onDone: () => void;
}

export default function TradeModal({ open, onOpenChange, portfolioId, type, onDone }: Props) {
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const clean = symbol.toUpperCase().trim();
    if (!clean) {
      toast.error("Asset symbol is required.");
      setSaving(false);
      return;
    }

    const qty = Number(quantity || 0);
    if (type !== "remove" && (!Number.isFinite(qty) || qty <= 0)) {
      toast.error("Quantity must be greater than zero.");
      setSaving(false);
      return;
    }

    const px = price ? Number(price) : null;
    if ((type === "buy" || type === "sell") && (!px || px <= 0)) {
      toast.error("Price is required for buy/sell.");
      setSaving(false);
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      toast.error("Not authenticated.");
      setSaving(false);
      return;
    }

    const { data: existingAsset } = await supabase.from("assets").select("id").eq("symbol", clean).maybeSingle();
    let assetId = existingAsset?.id;
    if (!assetId) {
      const { data: created, error: createError } = await supabase.from("assets").insert({ symbol: clean, name: clean }).select("id").single();
      if (createError || !created) {
        toast.error(createError?.message || "Failed to create asset.");
        setSaving(false);
        return;
      }
      assetId = created.id;
    }

    const { error } = await supabase.from("transactions" as any).insert({
      portfolio_id: portfolioId,
      user_id: auth.user.id,
      asset_id: assetId,
      type,
      quantity: type === "sell" ? -Math.abs(qty) : qty,
      price: px,
      currency,
      note: note || null,
      traded_at: new Date().toISOString(),
    });

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`${type} transaction recorded.`);
    setSymbol("");
    setQuantity("");
    setPrice("");
    setNote("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{type.toUpperCase()} trade</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Asset symbol</Label><Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL" /></div>
          {type !== "remove" && <div><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>}
          {(type === "buy" || type === "sell") && <div><Label>Price</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
          <div><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
          <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving..." : "Confirm"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
