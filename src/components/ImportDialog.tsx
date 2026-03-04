import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { groupNordeaHoldingsByAccount, parseCSV, parseExcelImport, parseJSONImport, validateImportRows, type NordeaAccountGroup } from "@/lib/portfolio-utils";
import { applyTickerResolutionsToRows, extractTickerAndExchange, normalizeTicker } from "@/lib/ticker-resolution";
import { logAuditAction } from "@/lib/audit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ImportFormat = "csv" | "json" | "xlsx";
type ImportMode = "replace" | "merge";
type Visibility = "private" | "authenticated" | "group" | "public";

interface PortfolioChoice { id: string; name: string; base_currency: string; }
interface AccountSelection {
  target: string;
  portfolioName: string;
  baseCurrency: string;
  visibility: Visibility;
}

interface ResolverItem { isin: string; name: string; mic?: string; }

interface Props { open: boolean; onOpenChange: (v: boolean) => void; portfolioId: string; onImported: () => void; }

export default function ImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const [step, setStep] = useState(1);
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [mode, setMode] = useState<ImportMode>("replace");
  const [rows, setRows] = useState<any[]>([]);
  const [detectedNordea, setDetectedNordea] = useState(false);
  const [busy, setBusy] = useState(false);
  const [existingPortfolios, setExistingPortfolios] = useState<PortfolioChoice[]>([]);
  const [nordeaAccounts, setNordeaAccounts] = useState<NordeaAccountGroup[]>([]);
  const [accountSelections, setAccountSelections] = useState<Record<string, AccountSelection>>({});
  const [tickerResolutions, setTickerResolutions] = useState<Record<string, string>>({});
  const [tickerSuggestions, setTickerSuggestions] = useState<Record<string, string[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalSteps = detectedNordea ? 6 : 4;
  const validRows = useMemo(() => rows.filter((r) => r.valid), [rows]);
  const resolverItems = useMemo<ResolverItem[]>(() => {
    if (!detectedNordea) return [];
    const byIsin = new Map<string, ResolverItem>();
    validRows.forEach((row) => {
      const isin = String(row?.metadata_json?.isin ?? row.symbol ?? "").trim();
      if (!isin || byIsin.has(isin)) return;
      byIsin.set(isin, { isin, name: String(row.name || "").trim() || isin, mic: String(row?.metadata_json?.mic || "").trim() || undefined });
    });
    return [...byIsin.values()];
  }, [detectedNordea, validRows]);

  useEffect(() => {
    if (!detectedNordea) return;
    const defaults: Record<string, string> = {};
    resolverItems.forEach((item) => {
      defaults[item.isin] = tickerResolutions[item.isin] || "";
    });
    setTickerResolutions(defaults);
  }, [detectedNordea, resolverItems]);

  const fetchSuggestion = async (item: ResolverItem) => {
    const { data, error } = await supabase.functions.invoke("resolve-asset-ticker", { body: { mode: "suggest", isin: item.isin, name: item.name, mic: item.mic } });
    if (error) {
      toast.error(`No suggestions for ${item.isin}`);
      return;
    }
    const symbols = ((data?.suggestions || []) as any[]).map((x) => String(x.symbol || "").toUpperCase()).filter(Boolean).slice(0, 3);
    setTickerSuggestions((prev) => ({ ...prev, [item.isin]: symbols }));
    if (data?.suggested) {
      setTickerResolutions((prev) => ({ ...prev, [item.isin]: normalizeTicker(String(data.suggested)) }));
    }
  };

  const parseFile = async (payload: string | ArrayBuffer, fileFormat: ImportFormat) => {
    if (fileFormat === "xlsx") {
      const spreadsheet = parseExcelImport(payload as ArrayBuffer);
      const validated = validateImportRows(spreadsheet.holdings);
      setDetectedNordea(spreadsheet.detectedNordea);
      setRows(validated);

      if (spreadsheet.detectedNordea) {
        const groups = spreadsheet.nordeaAccounts ?? groupNordeaHoldingsByAccount(spreadsheet.holdings);
        setNordeaAccounts(groups);

        const { data: userPortfolios } = await supabase
          .from("portfolios")
          .select("id,name,base_currency")
          .order("created_at", { ascending: false });

        setExistingPortfolios(userPortfolios || []);
        const defaults: Record<string, AccountSelection> = {};
        groups.forEach((group) => {
          defaults[group.accountKey] = {
            target: "new",
            portfolioName: `Nordea - ${group.accountName}`,
            baseCurrency: group.baseCurrency || spreadsheet.baseCurrency || "SEK",
            visibility: "private",
          };
        });
        setAccountSelections(defaults);
      }

      setStep(3);
      return;
    }

    const parsed = fileFormat === "json" ? parseJSONImport(payload as string).holdings : parseCSV(payload as string);
    setDetectedNordea(false);
    setNordeaAccounts([]);
    setAccountSelections({});
    setRows(validateImportRows(parsed));
    setStep(3);
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        await parseFile(ev.target?.result as string | ArrayBuffer, format);
      } catch {
        toast.error("Could not parse file.");
      }
    };
    if (format === "xlsx") {
      reader.readAsArrayBuffer(file);
      return;
    }
    reader.readAsText(file);
  };

  const upsertHoldingRows = async (targetPortfolioId: string, importRows: any[], replacedPortfolios: Set<string>) => {
    if (mode === "replace" && !replacedPortfolios.has(targetPortfolioId)) {
      await supabase.from("holdings").delete().eq("portfolio_id", targetPortfolioId);
      replacedPortfolios.add(targetPortfolioId);
    }

    for (const row of importRows) {
      const { data: asset } = await supabase.from("assets").select("id").eq("symbol", row.symbol).maybeSingle();
      const assetId = asset?.id || (await supabase.from("assets").insert({
        symbol: row.symbol,
        name: row.name || row.symbol,
        asset_type: row.asset_type as any,
        exchange: row.exchange || null,
        currency: row.cost_currency,
        metadata_json: row.metadata_json ?? null,
      }).select("id").single()).data?.id;
      if (!assetId) continue;

      const { data: existing } = await supabase.from("holdings").select("id,quantity,avg_cost").eq("portfolio_id", targetPortfolioId).eq("asset_id", assetId).maybeSingle();
      if (existing) {
        const qty = mode === "merge" ? Number(existing.quantity) + row.quantity : row.quantity;
        const avg = mode === "merge" ? ((Number(existing.quantity) * Number(existing.avg_cost)) + (row.quantity * row.avg_cost)) / qty : row.avg_cost;
        await supabase.from("holdings").update({ quantity: qty, avg_cost: avg, cost_currency: row.cost_currency }).eq("id", existing.id);
      } else {
        await supabase.from("holdings").insert({ portfolio_id: targetPortfolioId, asset_id: assetId, quantity: row.quantity, avg_cost: row.avg_cost, cost_currency: row.cost_currency });
      }
    }
  };

  const runImport = async () => {
    setBusy(true);

    if (!detectedNordea) {
      await upsertHoldingRows(portfolioId, validRows, new Set<string>());
      await logAuditAction("import", "portfolio", portfolioId, { mode, valid_rows: validRows.length, total_rows: rows.length });
      setBusy(false);
      onOpenChange(false);
      onImported();
      toast.success(`Imported ${validRows.length} holdings.`);
      return;
    }

    const unresolved = resolverItems.some((item) => !tickerResolutions[item.isin]?.trim());
    if (unresolved) {
      setBusy(false);
      toast.error("Please resolve all Nordea ISINs to tickers before importing.");
      return;
    }

    await supabase.functions.invoke("resolve-asset-ticker", {
      body: {
        mode: "apply",
        resolutions: resolverItems.map((item) => {
          const parsed = extractTickerAndExchange(tickerResolutions[item.isin] || "");
          return { isin: item.isin, ticker: parsed.ticker, exchange: parsed.exchange, name: item.name, mic: item.mic };
        }),
      },
    });

    const importRows = applyTickerResolutionsToRows(validRows, tickerResolutions);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setBusy(false);
      toast.error("Could not identify user for Nordea import.");
      return;
    }

    const replacedPortfolios = new Set<string>();
    for (const group of nordeaAccounts) {
      const selection = accountSelections[group.accountKey];
      if (!selection) continue;

      let targetPortfolioId = selection.target;
      if (selection.target === "new") {
        const { data: created, error } = await supabase.from("portfolios").insert({
          owner_user_id: userData.user.id,
          name: selection.portfolioName.trim(),
          base_currency: selection.baseCurrency,
          visibility: selection.visibility,
          broker: "nordea",
        }).select("id").single();

        if (error || !created?.id) {
          setBusy(false);
          toast.error(`Could not create portfolio for ${group.accountName}.`);
          return;
        }

        targetPortfolioId = created.id;
      }

      const accountRows = importRows.filter((row) => row.account_key === group.accountKey);
      await upsertHoldingRows(targetPortfolioId, accountRows, replacedPortfolios);
      await logAuditAction("import", "portfolio", targetPortfolioId, {
        mode,
        broker: "nordea",
        account_key: group.accountKey,
        valid_rows: accountRows.length,
        total_rows: rows.length,
      });
    }

    setBusy(false);
    onOpenChange(false);
    onImported();
    toast.success(`Imported ${validRows.length} holdings from Nordea.`);
  };

  const allResolved = resolverItems.every((item) => tickerResolutions[item.isin]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import holdings (Step {step}/{totalSteps})</DialogTitle></DialogHeader>

        {step === 1 && <div className="space-y-3"><p className="text-sm">Choose file format.</p><Select value={format} onValueChange={(v) => setFormat(v as ImportFormat)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="csv">CSV (symbol,quantity required)</SelectItem><SelectItem value="json">JSON</SelectItem><SelectItem value="xlsx">Excel (.xlsx)</SelectItem></SelectContent></Select><Button onClick={() => setStep(2)}>Continue</Button></div>}
        {step === 2 && <div className="space-y-3"><p className="text-sm">Upload your {format.toUpperCase()} file.</p><div className="border-dashed border rounded p-10 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}><Upload className="mx-auto mb-2" />Click to upload</div><input ref={fileInputRef} type="file" accept={format === "csv" ? ".csv" : format === "json" ? ".json" : ".xlsx"} className="hidden" onChange={onUpload} /><Button variant="outline" onClick={() => setStep(1)}>Back</Button></div>}

        {step === 3 && <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm">Preview and validation ({validRows.length}/{rows.length} valid)</p>
              {detectedNordea && <Badge variant="secondary">Nordea format detected</Badge>}
            </div>
            <Select value={mode} onValueChange={(v) => setMode(v as ImportMode)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="replace">Replace (default)</SelectItem><SelectItem value="merge">Merge</SelectItem></SelectContent></Select>
          </div>
          <Table><TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Avg cost</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((r, i) => <TableRow key={i}><TableCell>{r.symbol}</TableCell><TableCell>{r.quantity}</TableCell><TableCell>{r.avg_cost}</TableCell><TableCell>{r.valid ? <Badge>Valid</Badge> : <Badge variant="destructive">{r.errors[0]}</Badge>}</TableCell><TableCell>{!r.valid && <Button variant="ghost" size="sm" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>}</TableCell></TableRow>)}</TableBody></Table>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button onClick={() => setStep(4)} disabled={validRows.length === 0}>Continue</Button></div>
        </div>}

        {detectedNordea && step === 4 && <div className="space-y-4">
          <p className="text-sm font-medium">Select destination portfolio(s)</p>
          {nordeaAccounts.map((account) => {
            const selection = accountSelections[account.accountKey];
            return (
              <div key={account.accountKey} className="border rounded p-3 space-y-2">
                <div className="text-sm font-medium">{account.accountName} ({account.accountKey})</div>
                <div className="text-xs text-muted-foreground">{account.holdingsCount} holdings · {account.marketValueBase == null ? "Market value n/a" : `${account.marketValueBase.toFixed(2)} ${account.baseCurrency}`}</div>
                <Select value={selection?.target || "new"} onValueChange={(v) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], target: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create new portfolio</SelectItem>
                    {existingPortfolios.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>

                {selection?.target === "new" && <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-1"><Label>Portfolio name</Label><Input value={selection.portfolioName} onChange={(e) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], portfolioName: e.target.value } }))} /></div>
                  <div className="space-y-1"><Label>Base currency</Label><Input value={selection.baseCurrency} onChange={(e) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], baseCurrency: e.target.value.toUpperCase() } }))} /></div>
                  <div className="space-y-1"><Label>Visibility</Label><Select value={selection.visibility} onValueChange={(v) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], visibility: v as Visibility } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="authenticated">Logged-in</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select></div>
                </div>}
              </div>
            );
          })}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(3)}>Back</Button><Button onClick={() => setStep(5)}>Continue</Button></div>
        </div>}

        {detectedNordea && step === 5 && <div className="space-y-3">
          <p className="text-sm font-medium">Resolve tickers (recommended)</p>
          <Table><TableHeader><TableRow><TableHead>Name / ISIN</TableHead><TableHead>Ticker (required)</TableHead><TableHead>Suggestions</TableHead></TableRow></TableHeader><TableBody>
            {resolverItems.map((item) => <TableRow key={item.isin}><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-muted-foreground">{item.isin}</div></TableCell><TableCell><Input value={tickerResolutions[item.isin] || ""} onChange={(e) => setTickerResolutions((prev) => ({ ...prev, [item.isin]: normalizeTicker(e.target.value) }))} placeholder="e.g. AAPL" /></TableCell><TableCell><div className="flex gap-2 items-center"><Button variant="outline" size="sm" onClick={() => fetchSuggestion(item)}>Suggest</Button><div className="text-xs">{(tickerSuggestions[item.isin] || []).join(", ") || "No suggestions yet"}</div></div></TableCell></TableRow>)}
          </TableBody></Table>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(4)}>Back</Button><Button onClick={() => setStep(6)} disabled={!allResolved}>Continue</Button></div>
        </div>}

        {((!detectedNordea && step === 4) || (detectedNordea && step === 6)) && <div className="space-y-3"><p className="text-sm">You are about to {mode} holdings{detectedNordea ? " into selected portfolios" : " for this portfolio"}.</p><Button onClick={runImport} disabled={busy}>{busy ? "Importing..." : "Run import"}</Button></div>}
      </DialogContent>
    </Dialog>
  );
}
