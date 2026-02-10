import dotenv from "dotenv";
import path from "path";

// .env 파일을 프로젝트 루트에서 명시적으로 로드
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// 회사 프록시/방화벽 SSL 인증서 문제 우회 (개발 환경용)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || "1";

console.log("[ENV] MISO_API_KEY:", process.env.MISO_API_KEY ? "설정됨" : "미설정");
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
