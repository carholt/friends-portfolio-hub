import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { LeaderboardTable } from "@/components/LeaderboardTable";

export default function Leaderboard() {
  const { data: rows = [], isLoading, error, refetch } = useLeaderboard();

  return (
    <AppLayout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
      </div>
      <Card>
        <CardContent className="pt-6">
          {isLoading && <PageSkeleton rows={4} />}
          {error && <ErrorState message={error.message} onAction={() => refetch()} />}
          {!isLoading && !error && rows.length === 0 && (
            <EmptyState
              title="No ranked portfolios yet"
              message="Once portfolios get valuations, they will appear here."
              ctaLabel="Go to portfolios"
              onCta={() => {
                window.location.href = "/portfolios";
              }}
            />
          )}
          {!isLoading && !error && rows.length > 0 && <LeaderboardTable rows={rows} />}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
