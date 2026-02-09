import type { NewsArticle } from "../types";

interface StatsBarProps {
  articles: NewsArticle[];
}

export function StatsBar({ articles }: StatsBarProps) {
  const categoryCount = new Map<string, number>();
  for (const a of articles) {
    categoryCount.set(a.category, (categoryCount.get(a.category) || 0) + 1);
  }

  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-value">{articles.length}</span>
        <span className="stat-label">전체 기사</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{categoryCount.size}</span>
        <span className="stat-label">카테고리</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">
          {new Set(articles.map((a) => a.source)).size}
        </span>
        <span className="stat-label">소스</span>
      </div>
    </div>
  );
}
