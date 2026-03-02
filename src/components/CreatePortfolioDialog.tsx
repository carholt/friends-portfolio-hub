import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logAuditAction } from "@/lib/audit";

interface Props { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void; }

export default function CreatePortfolioDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [baseCurrency, setBaseCurrency] = useState("SEK");
  const [groupId, setGroupId] = useState<string>("none");
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [quickGroupName, setQuickGroupName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || !open) return;
    supabase.from("group_members").select("group:groups(id,name)").eq("user_id", user.id).then(({ data }) => {
      setGroups((data || []).map((r: any) => r.group).filter(Boolean));
    });
  }, [open, user]);

  const createQuickGroup = async () => {
    if (!user || !quickGroupName.trim()) return;
    const { data, error } = await supabase.from("groups").insert({ owner_user_id: user.id, name: quickGroupName.trim() }).select("id,name").single();
    if (error || !data) return toast.error(error?.message || "Could not create group");
    setGroups((prev) => [data, ...prev]);
    setGroupId(data.id);
    setQuickGroupName("");
  };

  const handleCreate = async () => {
    if (!user || !name.trim()) return;
    if (visibility === "group" && groupId === "none") return toast.error("Please select a group for group visibility.");
    setLoading(true);
    const slug = visibility === "public" ? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}` : null;
    const { data, error } = await supabase.from("portfolios").insert({
      owner_user_id: user.id, name: name.trim(), description: description.trim() || null, visibility: visibility as any,
      group_id: visibility === "group" ? groupId : null, base_currency: baseCurrency, public_slug: slug,
    }).select("id").single();

    if (error) toast.error(error.message);
    else {
      await logAuditAction("portfolio_create", "portfolio", data?.id, { visibility, baseCurrency });
      toast.success("Portfölj skapad!");
      setName(""); setDescription(""); setVisibility("private"); setGroupId("none"); onOpenChange(false); onCreated();
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Skapa ny portfölj</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Namn</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Min guldportfölj" /></div>
          <div className="space-y-2"><Label>Beskrivning</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Valfri beskrivning…" rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Synlighet</Label><Select value={visibility} onValueChange={setVisibility}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Privat</SelectItem><SelectItem value="authenticated">Alla inloggade</SelectItem><SelectItem value="group">Vängrupp</SelectItem><SelectItem value="public">Publik</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Basvaluta</Label><Select value={baseCurrency} onValueChange={setBaseCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SEK">SEK</SelectItem><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem></SelectContent></Select></div>
          </div>
          {visibility === "group" && (
            <div className="space-y-2">
              <Label>Välj grupp</Label>
              {groups.length > 0 ? <Select value={groupId} onValueChange={setGroupId}><SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger><SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select> :
                <div className="p-3 rounded-md border space-y-2"><p className="text-sm text-muted-foreground">No groups yet. Create group</p><div className="flex gap-2"><Input value={quickGroupName} onChange={(e) => setQuickGroupName(e.target.value)} placeholder="Friends" /><Button type="button" variant="outline" onClick={createQuickGroup}>Create group</Button></div></div>}
            </div>
          )}
          {visibility === "public" && <p className="text-xs text-amber-600">Public means anyone with the link can view.</p>}
          <Button variant="hero" className="w-full" onClick={handleCreate} disabled={loading || !name.trim()}>{loading ? "Skapar…" : "Skapa portfölj"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
