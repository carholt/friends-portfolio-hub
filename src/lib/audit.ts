import { supabase } from "@/integrations/supabase/client";

export async function logAuditAction(action: string, entityType?: string, entityId?: string, details?: Record<string, unknown>) {
  const { error } = await supabase.rpc("log_audit_action", {
    _action: action,
    _entity_type: entityType ?? null,
    _entity_id: entityId ?? null,
    _details: details ?? {},
  });

  if (error) {
    const key = "local_activity";
    const list = JSON.parse(localStorage.getItem(key) || "[]") as unknown[];
    list.unshift({ action, entityType, entityId, details, createdAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 100)));
  }
}
