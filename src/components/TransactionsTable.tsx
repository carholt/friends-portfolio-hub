import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { rebuildHoldingsAndRefreshValuation } from "@/lib/portfolio-refresh";

type TxType = "buy" | "sell" | "adjust" | "remove";

interface Props {
  rows: any[];
  onChanged: () => void;
}

interface FormState {
  id: string;
  portfolio_id: string;
  type: TxType;
  quantity: string;
  price: string;
  currency: string;
  exchange: string;
  broker: string;
  fees: string;
  trade_id: string;
  traded_at: string;
}

const EMPTY_ERRORS: Record<string, string> = {};

export default function TransactionsTable({ rows, onChanged }: Props) {
  const [editing, setEditing] = useState<FormState | null>(null);
  const [deleteTx, setDeleteTx] = useState<any | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>(EMPTY_ERRORS);
  const [saving, setSaving] = useState(false);

  const formDate = useMemo(() => editing?.traded_at ? new Date(editing.traded_at).toISOString().slice(0, 16) : "", [editing]);

  const validate = (form: FormState) => {
    const next: Record<string, string> = {};
    if (!form.type) next.type = "Transaction type is required";
    if (!form.quantity || Number(form.quantity) <= 0) next.quantity = "Quantity must be greater than zero";
    if ((form.type === "buy" || form.type === "sell") && (!form.price || Number(form.price) <= 0)) next.price = "Price must be greater than zero";
    if (!form.currency.trim()) next.currency = "Currency is required";
    if (!form.traded_at) next.traded_at = "Trade date is required";
    return next;
  };

  const saveEdit = async () => {
    if (!editing) return;
    const validation = validate(editing);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setSaving(true);

    const { error } = await supabase.from("transactions" as never).update({
      type: editing.type,
      quantity: Number(editing.quantity),
      price: editing.price ? Number(editing.price) : null,
      currency: editing.currency.toUpperCase(),
      exchange: editing.exchange || null,
      broker: editing.broker || null,
      fees: editing.fees ? Number(editing.fees) : null,
      trade_id: editing.trade_id || null,
      traded_at: new Date(editing.traded_at).toISOString(),
    } as never).eq("id", editing.id);

    if (error) {
      toast.error(`Could not update transaction: ${error.message}`);
      setSaving(false);
      return;
    }

    await rebuildHoldingsAndRefreshValuation(editing.portfolio_id);
    toast.success("Transaction updated and valuations refreshed.");
    setSaving(false);
    setEditing(null);
    setErrors(EMPTY_ERRORS);
    onChanged();
  };

  const removeTx = async () => {
    if (!deleteTx) return;
    const { error } = await supabase.from("transactions" as never).delete().eq("id", deleteTx.id);
    if (error) {
      toast.error(`Could not delete transaction: ${error.message}`);
      return;
    }
    await rebuildHoldingsAndRefreshValuation(deleteTx.portfolio_id);
    toast.success("Transaction deleted. Holdings and valuations were rebuilt.");
    setDeleteTx(null);
    onChanged();
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead><TableHead>Asset</TableHead><TableHead>Type</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead>Value</TableHead><TableHead>Broker</TableHead><TableHead>User</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((tx) => (
            <TableRow key={tx.id}>
              <TableCell>{new Date(tx.traded_at).toLocaleString()}</TableCell>
              <TableCell>{tx.asset?.symbol}</TableCell>
              <TableCell>{tx.type}</TableCell>
              <TableCell>{tx.quantity}</TableCell>
              <TableCell>{tx.price ?? "-"}</TableCell>
              <TableCell>{tx.price ? (Number(tx.quantity) * Number(tx.price)).toFixed(2) : "-"}</TableCell>
              <TableCell>{tx.broker || "-"}</TableCell>
              <TableCell>{tx.user?.display_name || "-"}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({
                    id: tx.id,
                    portfolio_id: tx.portfolio_id,
                    type: tx.type,
                    quantity: String(Math.abs(Number(tx.quantity || 0))),
                    price: tx.price == null ? "" : String(tx.price),
                    currency: tx.currency || "USD",
                    exchange: tx.exchange || "",
                    broker: tx.broker || "",
                    fees: tx.fees == null ? "" : String(tx.fees),
                    trade_id: tx.trade_id || "",
                    traded_at: tx.traded_at,
                  })}>Edit</Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteTx(tx)}>Delete</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit transaction</DialogTitle></DialogHeader>
          {editing && <div className="space-y-2">
            <div><Label>Type</Label><Select value={editing.type} onValueChange={(value) => setEditing((prev) => prev ? { ...prev, type: value as TxType } : prev)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="buy">Buy</SelectItem><SelectItem value="sell">Sell</SelectItem><SelectItem value="adjust">Adjust</SelectItem><SelectItem value="remove">Remove</SelectItem></SelectContent></Select>{errors.type && <p className="text-xs text-destructive">{errors.type}</p>}</div>
            <div><Label>Quantity</Label><Input value={editing.quantity} type="number" onChange={(e) => setEditing((prev) => prev ? { ...prev, quantity: e.target.value } : prev)} />{errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}</div>
            <div><Label>Price</Label><Input value={editing.price} type="number" onChange={(e) => setEditing((prev) => prev ? { ...prev, price: e.target.value } : prev)} />{errors.price && <p className="text-xs text-destructive">{errors.price}</p>}</div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Currency</Label><Input value={editing.currency} onChange={(e) => setEditing((prev) => prev ? { ...prev, currency: e.target.value } : prev)} />{errors.currency && <p className="text-xs text-destructive">{errors.currency}</p>}</div>
              <div><Label>Exchange (optional)</Label><Input value={editing.exchange} onChange={(e) => setEditing((prev) => prev ? { ...prev, exchange: e.target.value } : prev)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Fees</Label><Input value={editing.fees} type="number" onChange={(e) => setEditing((prev) => prev ? { ...prev, fees: e.target.value } : prev)} /></div>
              <div><Label>Broker</Label><Input value={editing.broker} onChange={(e) => setEditing((prev) => prev ? { ...prev, broker: e.target.value } : prev)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Trade ID</Label><Input value={editing.trade_id} onChange={(e) => setEditing((prev) => prev ? { ...prev, trade_id: e.target.value } : prev)} /></div>
              <div><Label>Trade date</Label><Input type="datetime-local" value={formDate} onChange={(e) => setEditing((prev) => prev ? { ...prev, traded_at: e.target.value } : prev)} />{errors.traded_at && <p className="text-xs text-destructive">{errors.traded_at}</p>}</div>
            </div>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </div>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTx} onOpenChange={(open) => !open && setDeleteTx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the transaction and rebuild holdings and portfolio valuations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={removeTx}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
