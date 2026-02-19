import type { PublishedItem, QueueItem } from "@/lib/workspace";

export function toDayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function getTodayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function getCurrentMonthKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildCalendarCells(
  monthKey: string,
  queueByDay: Map<string, QueueItem[]>
): Array<{
  key: string;
  day: number;
  inMonth: boolean;
  hasItems: boolean;
  count: number;
}> {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return [];
  }

  const firstDay = new Date(year, month - 1, 1);
  const start = new Date(firstDay);
  const dayOfWeek = (firstDay.getDay() + 6) % 7;
  start.setDate(firstDay.getDate() - dayOfWeek);

  const cells: Array<{
    key: string;
    day: number;
    inMonth: boolean;
    hasItems: boolean;
    count: number;
  }> = [];

  for (let i = 0; i < 42; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(current.getDate()).padStart(2, "0")}`;
    const list = queueByDay.get(key) ?? [];
    cells.push({
      key,
      day: current.getDate(),
      inMonth: current.getMonth() + 1 === month,
      hasItems: list.length > 0,
      count: list.length
    });
  }
  return cells;
}

export function formatNumber(value: number): string {
  return Intl.NumberFormat("zh-CN").format(value);
}

export function computeAnalytics(published: PublishedItem[]): {
  totalPosts: number;
  impressions: number;
  avgEngagementRate: number;
  bestHours: Array<{ hour: number; avgEngagementRate: number; count: number }>;
} {
  if (published.length === 0) {
    return {
      totalPosts: 0,
      impressions: 0,
      avgEngagementRate: 0,
      bestHours: []
    };
  }

  const impressions = published.reduce(
    (sum, item) => sum + item.metrics.impressions,
    0
  );

  const avgEngagementRate = round(
    published.reduce((sum, item) => sum + item.metrics.engagementRate, 0) /
      published.length,
    2
  );

  const byHour = new Map<number, { count: number; erSum: number }>();
  published.forEach((item) => {
    const hour = new Date(item.publishedAt).getHours();
    const slot = byHour.get(hour) ?? { count: 0, erSum: 0 };
    slot.count += 1;
    slot.erSum += item.metrics.engagementRate;
    byHour.set(hour, slot);
  });

  const bestHours = Array.from(byHour.entries())
    .map(([hour, slot]) => ({
      hour,
      count: slot.count,
      avgEngagementRate: round(slot.erSum / slot.count, 2)
    }))
    .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate)
    .slice(0, 3);

  return {
    totalPosts: published.length,
    impressions,
    avgEngagementRate,
    bestHours
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
