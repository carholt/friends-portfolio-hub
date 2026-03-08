import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rebuildHoldingsAndRefreshValuation } from "@/lib/portfolio-refresh";

export type TradeType = "buy" | "sell" | "adjust" | "remove";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portfolioId: string;
  type: TradeType;
  onDone: () => void;
}

export default function TradeModal({ open, onOpenChange, portfolioId, type, onDone }: Props) {
  const [txType, setTxType] = useState<TradeType>(type);
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [exchange, setExchange] = useState("");
  const [broker, setBroker] = useState("manual");
  const [fees, setFees] = useState("0");
  const [tradeId, setTradeId] = useState("");
  const [tradedAt, setTradedAt] = useState(new Date().toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setSaving(true);
    const clean = symbol.toUpperCase().trim();
    const nextErrors: Record<string, string> = {};

    if (!clean) nextErrors.symbol = "Symbol is required.";
    if (!quantity || Number(quantity) <= 0) nextErrors.quantity = "Quantity must be greater than zero.";
    if ((txType === "buy" || txType === "sell") && (!price || Number(price) <= 0)) nextErrors.price = "Price is required for buy/sell.";
    if (!currency.trim()) nextErrors.currency = "Currency is required.";
    if (!tradedAt) nextErrors.tradedAt = "Trade date is required.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
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
      type: txType,
      quantity: Number(quantity),
      price: price ? Number(price) : null,
      currency: currency.toUpperCase(),
      exchange: exchange || null,
      broker: broker || null,
      trade_id: tradeId || null,
      fees: fees ? Number(fees) : null,
      traded_at: new Date(tradedAt).toISOString(),
    });

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    await rebuildHoldingsAndRefreshValuation(portfolioId);
    toast.success("Transaction recorded and portfolio valuation refreshed.");
    setSymbol("");
    setQuantity("");
    setPrice("");
    setTradeId("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add transaction</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Type</Label><Select value={txType} onValueChange={(value) => setTxType(value as TradeType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="buy">Buy</SelectItem><SelectItem value="sell">Sell</SelectItem><SelectItem value="adjust">Adjust</SelectItem><SelectItem value="remove">Remove</SelectItem></SelectContent></Select></div>
          <div><Label>Asset symbol</Label><Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL" />{errors.symbol && <p className="text-xs text-destructive">{errors.symbol}</p>}</div>
          <div><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />{errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}</div>
          <div><Label>Price</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />{errors.price && <p className="text-xs text-destructive">{errors.price}</p>}</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />{errors.currency && <p className="text-xs text-destructive">{errors.currency}</p>}</div>
            <div><Label>Exchange (optional)</Label><Input value={exchange} onChange={(e) => setExchange(e.target.value.toUpperCase())} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Fees</Label><Input type="number" value={fees} onChange={(e) => setFees(e.target.value)} /></div>
            <div><Label>Broker</Label><Input value={broker} onChange={(e) => setBroker(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Trade ID (optional)</Label><Input value={tradeId} onChange={(e) => setTradeId(e.target.value)} /></div>
            <div><Label>Trade date</Label><Input type="datetime-local" value={tradedAt} onChange={(e) => setTradedAt(e.target.value)} />{errors.tradedAt && <p className="text-xs text-destructive">{errors.tradedAt}</p>}</div>
          </div>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving..." : "Confirm"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
