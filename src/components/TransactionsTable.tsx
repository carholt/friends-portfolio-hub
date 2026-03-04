import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  rows: any[];
  onChanged: () => void;
}

export default function TransactionsTable({ rows, onChanged }: Props) {
  const removeTx = async (id: string) => {
    const { error } = await supabase.from("transactions" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Transaction removed");
      onChanged();
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead><TableHead>Asset</TableHead><TableHead>Type</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead>Value</TableHead><TableHead>Note</TableHead><TableHead>User</TableHead><TableHead />
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
            <TableCell>{tx.note || ""}</TableCell>
            <TableCell>{tx.user?.display_name || "-"}</TableCell>
            <TableCell><Button variant="ghost" size="sm" onClick={() => removeTx(tx.id)}>Undo</Button></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
