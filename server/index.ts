import "dotenv/config";
import express from "express";
import { fetchAllFeeds } from "./feeds";
import workflowRouter from "./workflow";

const app = express();
const PORT = 3001;

app.use(express.json());

// In-memory cache
let cachedNews: Awaited<ReturnType<typeof fetchAllFeeds>> = [];
let lastFetchTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

async function getNews() {
  const now = Date.now();
  if (now - lastFetchTime > CACHE_DURATION || cachedNews.length === 0) {
    cachedNews = await fetchAllFeeds();
    lastFetchTime = now;
  }
  return cachedNews;
}

app.get("/api/news", async (_req, res) => {
  try {
    const news = await getNews();
    res.json({ articles: news, lastUpdated: lastFetchTime });
  } catch (error) {
    console.error("Failed to fetch news:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

app.get("/api/news/refresh", async (_req, res) => {
  try {
    lastFetchTime = 0; // force refresh
    const news = await getNews();
    res.json({ articles: news, lastUpdated: lastFetchTime });
  } catch (error) {
    console.error("Failed to refresh news:", error);
    res.status(500).json({ error: "Failed to refresh news" });
  }
});

// Workflow routes
app.use("/api/workflow", workflowRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
