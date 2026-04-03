import { env } from "@/config/env";

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return env.adminEmails.includes(email.trim().toLowerCase());
}
