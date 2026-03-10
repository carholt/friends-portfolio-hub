import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ExposureItem, StageItem, ValuationPoint } from "@/lib/mining-dashboard";

const riskColorMap: Record<string, string> = {
  low: "#22c55e",
  medium: "#f97316",
  high: "#ef4444",
};

export function PerformanceChart({ points, range }: { points: ValuationPoint[]; range: "7D" | "30D" | "90D" | "1Y" }) {
  const filtered = useMemo(() => {
    const max = { "7D": 7, "30D": 30, "90D": 90, "1Y": 365 }[range];
    if (points.length <= max) return points;
    return points.slice(-max);
  }, [points, range]);

  return (
    <ChartContainer config={{ value: { label: "Portfolio Value", color: "#c084fc" } }} className="h-[280px] w-full">
      <AreaChart data={filtered} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
        <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} width={56} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="value" type="monotone" stroke="#a855f7" strokeWidth={2.5} fill="url(#portfolio-fill)" />
      </AreaChart>
    </ChartContainer>
  );
}

export function MetalExposureChart({ data }: { data: ExposureItem[] }) {
  const colors = ["#94a3b8", "#facc15", "#c0c0c0", "#60a5fa", "#f97316"];
  return (
    <ChartContainer config={{ exposure: { label: "Metal Exposure", color: "#facc15" } }} className="h-[280px] w-full">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={54} outerRadius={95} paddingAngle={2}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <span>{name}: {Number(value).toFixed(1)}%</span>} />} />
      </PieChart>
    </ChartContainer>
  );
}

export function JurisdictionRiskChart({ data }: { data: ExposureItem[] }) {
  return (
    <ChartContainer config={{ value: { label: "Risk", color: "#22c55e" } }} className="h-[280px] w-full">
      <BarChart data={data} margin={{ left: 8, right: 8, top: 10 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={riskColorMap[entry.risk || "medium"] || "#f97316"} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function StageBreakdownChart({ data }: { data: StageItem[] }) {
  return (
    <ChartContainer config={{ value: { label: "Stage", color: "#60a5fa" } }} className="h-[280px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 18, top: 8, bottom: 8 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" />
        <YAxis type="category" dataKey="stage" width={90} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="#60a5fa" radius={[0, 8, 8, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
