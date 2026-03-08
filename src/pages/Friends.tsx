import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { FriendList } from "@/components/FriendList";
import { supabase } from "@/integrations/supabase/client";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useNavigate } from "react-router-dom";

export default function FriendsPage() {
  const navigate = useNavigate();
  const { data: friends = [], isLoading, error, refetch } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { from: (table: string) => ReturnType<typeof supabase.from> }).from("friends").select("id,friend_user_id,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold">Friends</h1>
      {isLoading && <PageSkeleton rows={2} />}
      {error && <ErrorState message="Could not load friends." onAction={refetch} />}
      {!isLoading && !error && friends.length === 0 && <EmptyState title="No friends yet" message="Add friends to share private portfolios and compare performance." ctaLabel="Create group" onCta={() => navigate("/groups")} secondaryCtaLabel="Go home" onSecondaryCta={() => navigate("/")} />}
      {!isLoading && !error && friends.length > 0 && <FriendList friends={friends} onChanged={refetch} />}
    </AppLayout>
  );
}
