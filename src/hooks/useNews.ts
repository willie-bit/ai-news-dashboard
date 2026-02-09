import { useState, useEffect, useCallback } from "react";
import type { NewsArticle, NewsResponse } from "../types";

export function useNews() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = refresh ? "/api/news/refresh" : "/api/news";
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Failed to fetch news");
      const data: NewsResponse = await res.json();
      setArticles(data.articles);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  const refresh = useCallback(() => fetchNews(true), [fetchNews]);

  return { articles, lastUpdated, loading, error, refresh };
}
