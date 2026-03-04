import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export default function Groups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupPortfolios, setGroupPortfolios] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [leaderboardMode, setLeaderboardMode] = useState<"percent" | "absolute">("percent");
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const load = async () => {
    if (!user) return;
    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id, role, group:groups(id, name)")
      .eq("user_id", user.id);

    const g = memberships?.map((m) => ({ ...m.group, role: m.role })) || [];
    setGroups(g);
    if (!selectedGroupId && g[0]?.id) setSelectedGroupId(g[0].id);
  };

  const loadGroupData = async () => {
    if (!selectedGroupId) return;
    const { data: portfolios } = await supabase
      .from("portfolios")
      .select("id,name,owner_user_id,holdings(quantity,asset:assets(symbol,name))")
      .eq("group_id", selectedGroupId);

    const ids = (portfolios || []).map((p) => p.id);
    const { data: valuations } = ids.length
      ? await supabase.from("portfolio_valuations").select("portfolio_id,total_value,as_of_date").in("portfolio_id", ids).order("as_of_date", { ascending: false })
      : { data: [] as any[] };

    const latest = new Map<string, number>();
    const first = new Map<string, number>();
    [...(valuations || [])].reverse().forEach((v) => first.set(v.portfolio_id, Number(v.total_value)));
    (valuations || []).forEach((v) => {
      if (!latest.has(v.portfolio_id)) latest.set(v.portfolio_id, Number(v.total_value));
    });

    setGroupPortfolios((portfolios || []).map((p: any) => ({
      ...p,
      total: latest.get(p.id) ?? 0,
      absoluteReturn: (latest.get(p.id) ?? 0) - (first.get(p.id) ?? (latest.get(p.id) ?? 0)),
      percentReturn: (first.get(p.id) ?? 0) > 0 ? (((latest.get(p.id) ?? 0) - (first.get(p.id) ?? 0)) / (first.get(p.id) ?? 1)) * 100 : 0,
    })));

    const { data: board } = await supabase
      .from("group_messages" as any)
      .select("*, profile:profiles(display_name)")
      .eq("group_id", selectedGroupId)
      .order("created_at", { ascending: false })
      .limit(100);

    setMessages(board || []);
  };

  useEffect(() => { load(); }, [user]);
  useEffect(() => { loadGroupData(); }, [selectedGroupId]);

  const createGroup = async () => {
    if (!user || !newGroupName.trim()) return;
    const { error } = await supabase.from("groups").insert({ owner_user_id: user.id, name: newGroupName.trim() });
    if (error) toast.error(error.message);
    else {
      setShowCreate(false);
      setNewGroupName("");
      load();
    }
  };

  const sendMessage = async () => {
    if (!user || !selectedGroupId || !newMessage.trim()) return;
    const { error } = await supabase.from("group_messages" as any).insert({ group_id: selectedGroupId, user_id: user.id, body: newMessage.trim(), type: "message" });
    if (error) toast.error(error.message);
    else {
      setNewMessage("");
      loadGroupData();
    }
  };

  const leaderboard = useMemo(() => {
    const key = leaderboardMode === "percent" ? "percentReturn" : "absoluteReturn";
    return [...groupPortfolios].sort((a, b) => Number(b[key]) - Number(a[key]));
  }, [groupPortfolios, leaderboardMode]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Group portfolios</h1>
          <Button onClick={() => setShowCreate(true)}>Create group</Button>
        </div>

        <div className="flex gap-2 flex-wrap">{groups.map((g) => <Button key={g.id} variant={g.id === selectedGroupId ? "default" : "outline"} onClick={() => setSelectedGroupId(g.id)}>{g.name}</Button>)}</div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Members portfolios</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-3">
                {groupPortfolios.map((p) => (
                  <Card key={p.id}><CardContent className="pt-4 space-y-1">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-sm">Total: {p.total.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">Top holdings: {(p.holdings || []).slice(0, 3).map((h: any) => h.asset?.symbol).join(", ") || "-"}</div>
                  </CardContent></Card>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Leaderboard</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-2"><Button size="sm" variant={leaderboardMode === "percent" ? "default" : "outline"} onClick={() => setLeaderboardMode("percent")}>Return %</Button><Button size="sm" variant={leaderboardMode === "absolute" ? "default" : "outline"} onClick={() => setLeaderboardMode("absolute")}>Absolute</Button></div>
              <Table><TableHeader><TableRow><TableHead>Rank</TableHead><TableHead>Portfolio</TableHead><TableHead>Score</TableHead></TableRow></TableHeader><TableBody>{leaderboard.map((row, idx) => <TableRow key={row.id}><TableCell>{idx + 1}</TableCell><TableCell>{row.name}</TableCell><TableCell>{leaderboardMode === "percent" ? `${row.percentReturn.toFixed(2)}%` : row.absoluteReturn.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Group board</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2"><Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Share a note with your group" /><Button onClick={sendMessage}>Post</Button></div>
            <div className="space-y-2">
              {messages.map((m) => <div key={m.id} className="rounded border p-2"><div className="text-xs text-muted-foreground">{m.profile?.display_name || "Member"} · {new Date(m.created_at).toLocaleString()}</div><div>{m.body}</div></div>)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create group</DialogTitle></DialogHeader>
          <div className="space-y-2"><Label>Group name</Label><Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} /><Button className="w-full" onClick={createGroup}>Create</Button></div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
