export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  category: string;
  publishedAt: string;
}

export interface NewsResponse {
  articles: NewsArticle[];
  lastUpdated: number;
}
