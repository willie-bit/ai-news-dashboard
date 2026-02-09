import { XMLParser } from "fast-xml-parser";

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  category: string;
  publishedAt: string;
}

interface FeedConfig {
  url: string;
  source: string;
  category: string;
}

const FEEDS: FeedConfig[] = [
  {
    url: "https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    category: "General AI",
  },
  {
    url: "https://news.google.com/rss/search?q=machine+learning+deep+learning&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    category: "Machine Learning",
  },
  {
    url: "https://news.google.com/rss/search?q=ChatGPT+OR+Claude+OR+Gemini+LLM&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    category: "LLM",
  },
  {
    url: "https://news.google.com/rss/search?q=AI+startup+funding&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    category: "Industry",
  },
  {
    url: "https://news.google.com/rss/search?q=AI+regulation+policy+ethics&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
    category: "Policy & Ethics",
  },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractSummary(description: string): string {
  const cleaned = stripHtml(description);
  if (cleaned.length <= 200) return cleaned;
  return cleaned.slice(0, 200).replace(/\s+\S*$/, "") + "...";
}

async function fetchFeed(config: FeedConfig): Promise<NewsArticle[]> {
  try {
    const response = await fetch(config.url, {
      headers: {
        "User-Agent": "AI-News-Dashboard/1.0",
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${config.source} (${config.category}): ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const channel = parsed?.rss?.channel;
    if (!channel?.item) return [];

    const items = Array.isArray(channel.item) ? channel.item : [channel.item];

    return items.slice(0, 10).map((item: Record<string, string>, index: number) => ({
      id: `${config.category}-${index}-${Date.now()}`,
      title: stripHtml(item.title || "No title"),
      summary: extractSummary(item.description || ""),
      link: item.link || "",
      source: item.source?.toString() || config.source,
      category: config.category,
      publishedAt: item.pubDate || new Date().toISOString(),
    }));
  } catch (error) {
    console.error(`Error fetching feed ${config.source} (${config.category}):`, error);
    return [];
  }
}

export async function fetchAllFeeds(): Promise<NewsArticle[]> {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));

  const articles: NewsArticle[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      articles.push(...result.value);
    }
  }

  // Sort by publish date (newest first)
  articles.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return articles;
}
