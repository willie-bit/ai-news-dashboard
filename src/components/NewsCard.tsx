import type { NewsArticle } from "../types";

interface NewsCardProps {
  article: NewsArticle;
}

const CATEGORY_COLORS: Record<string, string> = {
  "General AI": "#6366f1",
  "Machine Learning": "#8b5cf6",
  LLM: "#ec4899",
  Industry: "#f59e0b",
  "Policy & Ethics": "#10b981",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export function NewsCard({ article }: NewsCardProps) {
  const color = CATEGORY_COLORS[article.category] || "#6366f1";

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="news-card"
    >
      <div className="card-header">
        <span className="category-badge" style={{ backgroundColor: color }}>
          {article.category}
        </span>
        <span className="time-ago">{timeAgo(article.publishedAt)}</span>
      </div>
      <h3 className="card-title">{article.title}</h3>
      {article.summary && <p className="card-summary">{article.summary}</p>}
      <div className="card-footer">
        <span className="card-source">{article.source}</span>
      </div>
    </a>
  );
}
