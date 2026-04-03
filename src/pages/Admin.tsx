import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { isAdminEmail } from "@/lib/admin";
import { isCompanyAiReport } from "@/lib/company-ai-report";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type ActivityRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  user_id: string | null;
  details: unknown;
  created_at: string;
};

export default function AdminPage() {
  const { user } = useAuth();
  const [symbol, setSymbol] = useState("");
  const [portfolioId, setPortfolioId] = useState("");
  const [assumptionsText, setAssumptionsText] = useState("{}");
  const [sourcesText, setSourcesText] = useState("[]");
  const [reportText, setReportText] = useState("{}");
  const [promptOutput, setPromptOutput] = useState("");

  const isAdmin = isAdminEmail(user?.email);

  const { data: activity = [], refetch: refetchActivity } = useQuery({
    queryKey: ["admin-activity", isAdmin],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id,action,entity_type,entity_id,user_id,details,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ActivityRow[];
    },
  });

  const assumptionsJson = useMemo(() => {
    try {
      return JSON.parse(assumptionsText || "{}");
    } catch {
      return null;
    }
  }, [assumptionsText]);

  const sourcesJson = useMemo(() => {
    try {
      return JSON.parse(sourcesText || "[]");
    } catch {
      return null;
    }
  }, [sourcesText]);

  const reportJson = useMemo(() => {
    try {
      return JSON.parse(reportText || "{}");
    } catch {
      return null;
    }
  }, [reportText]);

  if (!isAdmin) {
    return (
      <AppLayout>
        <Card>
          <CardHeader><CardTitle>Admin only</CardTitle></CardHeader>
          <CardContent>This page is restricted.</CardContent>
        </Card>
      </AppLayout>
    );
  }

  const createPrompt = async () => {
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) {
      toast.error("Enter a symbol first.");
      return;
    }
    const prompt = [
      `Create a structured company intelligence report for ${ticker}.`,
      "Return valid JSON only (no markdown), following exactly this schema:",
      JSON.stringify({
        ticker: "",
        name: "",
        bucket: "",
        type: "",
        properties_ownership: "",
        management_team: "",
        share_structure: "",
        location: "",
        projected_growth: "",
        market_buzz: "",
        cost_structure_financing: "",
        cash_debt_position: "",
        low_valuation_estimate: null,
        high_valuation_estimate: null,
        projected_price: null,
        investment_recommendation: "",
        rating: "",
        rationale: "",
        key_risks: [""],
        key_catalysts: [""],
        last_updated: new Date().toISOString().slice(0, 10),
        sources: [{ title: "", url: "", snippet: "" }],
      }),
      "Use concrete numbers when possible and keep each text field under 120 words.",
      `Additional assumptions: ${assumptionsText}`,
    ].join("\n\n");

    setPromptOutput(prompt);
    await navigator.clipboard.writeText(prompt);
    toast.success("Prompt copied to clipboard.");
  };

  const saveManualReport = async () => {
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) {
      toast.error("Symbol is required.");
      return;
    }
    if (!assumptionsJson || !sourcesJson || !reportJson) {
      toast.error("Invalid JSON in assumptions/sources/report.");
      return;
    }
    if (!isCompanyAiReport(reportJson)) {
      toast.error("Report JSON does not match required schema.");
      return;
    }

    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id,symbol")
      .eq("symbol", ticker)
      .maybeSingle();

    if (assetError || !asset) {
      toast.error(`Asset not found for symbol ${ticker}.`);
      return;
    }

    const { error } = await supabase
      .from("company_ai_reports")
      .insert({
        asset_id: asset.id,
        portfolio_id: portfolioId.trim() || null,
        created_by: user?.id ?? null,
        assumptions: assumptionsJson,
        sources: sourcesJson,
        report: reportJson,
        status: "completed",
        completed_at: new Date().toISOString(),
        model: "manual_admin_entry",
      });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Manual AI report saved.");
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Admin tools</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Ticker symbol (e.g. AAPL)" />
            <Input value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} placeholder="Portfolio UUID (optional)" />
            <Textarea value={assumptionsText} onChange={(e) => setAssumptionsText(e.target.value)} rows={4} placeholder="Assumptions JSON" />
            <Textarea value={sourcesText} onChange={(e) => setSourcesText(e.target.value)} rows={4} placeholder="Sources JSON array" />
            <Textarea value={reportText} onChange={(e) => setReportText(e.target.value)} rows={10} placeholder="Final AI report JSON" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={createPrompt}>Create + copy prompt</Button>
              <Button onClick={saveManualReport}>Save manual AI report</Button>
            </div>
            {promptOutput && <Textarea value={promptOutput} readOnly rows={10} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>All user activity (latest 200)</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3"><Button variant="outline" onClick={() => refetchActivity()}>Refresh</Button></div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{row.user_id || "-"}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell>{row.entity_type || "-"} {row.entity_id || ""}</TableCell>
                    <TableCell className="max-w-md whitespace-pre-wrap break-words text-xs">{JSON.stringify(row.details ?? {}, null, 2)}</TableCell>
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
