import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type AliasRow = {
  id: string;
  raw_symbol: string;
  exchange: string | null;
  broker: string | null;
  isin: string | null;
  canonical_symbol: string;
  price_symbol: string;
  confidence: number | null;
  resolution_source: string;
  is_active: boolean;
  instrument_id: string | null;
  updated_at: string;
};

type InstrumentRow = { id: string; price_symbol: string; canonical_symbol: string; exchange_code: string | null };

export default function SymbolResolutionSettingsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "overridden" | "low" | "inactive">("all");
  const [draft, setDraft] = useState({ raw_symbol: "", exchange: "", broker: "", isin: "", canonical_symbol: "", price_symbol: "", confidence: "0.99" });

  const { data: aliases = [], isLoading } = useQuery({
    queryKey: ["symbol-aliases"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("symbol_aliases")
        .select("id,raw_symbol,exchange,broker,isin,canonical_symbol,price_symbol,confidence,resolution_source,is_active,instrument_id,updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as AliasRow[];
    },
  });

  const { data: instruments = [] } = useQuery({
    queryKey: ["market-instruments-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("market_instruments")
        .select("id,price_symbol,canonical_symbol,exchange_code")
        .limit(500);
      if (error) throw error;
      return (data || []) as InstrumentRow[];
    },
  });

  const saveOverrideMutation = useMutation({
    mutationFn: async () => {
      const targetInstrument = instruments.find((item) => item.price_symbol.toUpperCase() === draft.price_symbol.trim().toUpperCase());
      const payload = {
        raw_symbol: draft.raw_symbol.trim().toUpperCase(),
        exchange: draft.exchange.trim().toUpperCase() || null,
        broker: draft.broker.trim().toLowerCase() || null,
        isin: draft.isin.trim().toUpperCase() || null,
        canonical_symbol: draft.canonical_symbol.trim().toUpperCase(),
        price_symbol: draft.price_symbol.trim().toUpperCase(),
        instrument_id: targetInstrument?.id ?? null,
        confidence: Number(draft.confidence || "0.99"),
        resolution_source: "manual_override",
        is_active: true,
      };

      const { data: existing } = await (supabase as any)
        .from("symbol_aliases")
        .select("id")
        .eq("raw_symbol", payload.raw_symbol)
        .eq("exchange", payload.exchange)
        .eq("broker", payload.broker)
        .eq("isin", payload.isin)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await (supabase as any).from("symbol_aliases").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("symbol_aliases").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Override saved");
      queryClient.invalidateQueries({ queryKey: ["symbol-aliases"] });
      setDraft({ raw_symbol: "", exchange: "", broker: "", isin: "", canonical_symbol: "", price_symbol: "", confidence: "0.99" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save override"),
  });

  const toggleAliasMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any).from("symbol_aliases").update({ is_active: !is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["symbol-aliases"] }),
  });

  const relinkMutation = useMutation({
    mutationFn: async ({ alias, instrumentId }: { alias: AliasRow; instrumentId: string }) => {
      const { error } = await (supabase as any).from("symbol_aliases").update({ instrument_id: instrumentId }).eq("id", alias.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alias relinked");
      queryClient.invalidateQueries({ queryKey: ["symbol-aliases"] });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (alias: AliasRow) => {
      const { data, error } = await (supabase as any).rpc("resolve_symbol_candidates", {
        _raw_symbol: alias.raw_symbol,
        _exchange: alias.exchange,
        _broker: alias.broker,
        _isin: alias.isin,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => toast.success(`Preview returned ${(data || []).length} candidate(s)`),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return aliases.filter((row) => {
      const hit = !q || [row.raw_symbol, row.canonical_symbol, row.price_symbol, row.exchange || "", row.isin || "", row.broker || ""].some((v) => v.toLowerCase().includes(q));
      if (!hit) return false;
      if (filter === "overridden") return row.resolution_source === "manual_override";
      if (filter === "low") return (row.confidence ?? 0) < 0.8;
      if (filter === "inactive") return !row.is_active;
      return true;
    });
  }, [aliases, filter, search]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Symbol resolution</h1>

        <Card>
          <CardHeader><CardTitle>Create manual override</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Input placeholder="Raw symbol" value={draft.raw_symbol} onChange={(e) => setDraft((p) => ({ ...p, raw_symbol: e.target.value }))} />
            <Input placeholder="Exchange" value={draft.exchange} onChange={(e) => setDraft((p) => ({ ...p, exchange: e.target.value }))} />
            <Input placeholder="Broker" value={draft.broker} onChange={(e) => setDraft((p) => ({ ...p, broker: e.target.value }))} />
            <Input placeholder="ISIN" value={draft.isin} onChange={(e) => setDraft((p) => ({ ...p, isin: e.target.value }))} />
            <Input placeholder="Canonical" value={draft.canonical_symbol} onChange={(e) => setDraft((p) => ({ ...p, canonical_symbol: e.target.value }))} />
            <Input placeholder="Price symbol" value={draft.price_symbol} onChange={(e) => setDraft((p) => ({ ...p, price_symbol: e.target.value }))} />
            <Input placeholder="Confidence" value={draft.confidence} onChange={(e) => setDraft((p) => ({ ...p, confidence: e.target.value }))} />
            <Button onClick={() => saveOverrideMutation.mutate()} disabled={saveOverrideMutation.isPending}>Save override</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Aliases and instruments</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-sm" placeholder="Search raw/canonical/price symbol" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
              <Button variant={filter === "overridden" ? "default" : "outline"} onClick={() => setFilter("overridden")}>Overridden</Button>
              <Button variant={filter === "low" ? "default" : "outline"} onClick={() => setFilter("low")}>Low confidence</Button>
              <Button variant={filter === "inactive" ? "default" : "outline"} onClick={() => setFilter("inactive")}>Inactive</Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raw</TableHead><TableHead>Exchange</TableHead><TableHead>Broker</TableHead><TableHead>ISIN</TableHead>
                  <TableHead>Canonical</TableHead><TableHead>Price symbol</TableHead><TableHead>Confidence</TableHead><TableHead>Source</TableHead><TableHead>Active</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!isLoading && filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.raw_symbol}</TableCell>
                    <TableCell>{row.exchange || "—"}</TableCell>
                    <TableCell>{row.broker || "—"}</TableCell>
                    <TableCell>{row.isin || "—"}</TableCell>
                    <TableCell>{row.canonical_symbol}</TableCell>
                    <TableCell>{row.price_symbol}</TableCell>
                    <TableCell>{row.confidence ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{row.resolution_source}</Badge></TableCell>
                    <TableCell>{row.is_active ? "yes" : "no"}</TableCell>
                    <TableCell className="space-x-2">
                      <Button size="sm" variant="outline" onClick={() => toggleAliasMutation.mutate({ id: row.id, is_active: row.is_active })}>{row.is_active ? "Disable" : "Enable"}</Button>
                      <Button size="sm" variant="outline" onClick={() => previewMutation.mutate(row)}>Preview</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const target = instruments.find((i) => i.price_symbol === row.price_symbol);
                          if (!target) return toast.error("No matching instrument for this price symbol");
                          relinkMutation.mutate({ alias: row, instrumentId: target.id });
                        }}
                      >Relink instrument</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
