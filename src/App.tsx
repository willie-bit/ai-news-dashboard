import { useMemo, useState } from "react";
import { useNews } from "./hooks/useNews";
import { Header } from "./components/Header";
import { CategoryFilter } from "./components/CategoryFilter";
import { NewsCard } from "./components/NewsCard";
import { StatsBar } from "./components/StatsBar";
import { ConstructionWorkflowBoard } from "./components/ConstructionWorkflowBoard";

type Tab = "news" | "workflow";

export default function App() {
  const { articles, lastUpdated, loading, error, refresh } = useNews();
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [activeTab, setActiveTab] = useState<Tab>("workflow");

  const categories = useMemo(() => {
    return [...new Set(articles.map((a) => a.category))];
  }, [articles]);

  const filtered = useMemo(() => {
    if (selectedCategory === "All") return articles;
    return articles.filter((a) => a.category === selectedCategory);
  }, [articles, selectedCategory]);

  return (
    <div className="app">
      <Header
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        loading={loading}
      />

      {/* Tab Navigation */}
      <div className="tab-nav">
        <div className="tab-nav-inner">
          <button
            className={`tab-btn ${activeTab === "news" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("news")}
          >
            AI 뉴스
          </button>
          <button
            className={`tab-btn ${activeTab === "workflow" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("workflow")}
          >
            공사 워크플로우
          </button>
        </div>
      </div>

      <main className="main">
        {activeTab === "news" && (
          <>
            <StatsBar articles={articles} />
            <CategoryFilter
              categories={categories}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
            />

            {error && (
              <div className="error-banner">
                <p>{error}</p>
                <button onClick={refresh}>다시 시도</button>
              </div>
            )}

            {loading && articles.length === 0 ? (
              <div className="loading-state">
                <div className="spinner" />
                <p>AI 뉴스를 불러오는 중...</p>
              </div>
            ) : (
              <div className="news-grid">
                {filtered.map((article) => (
                  <NewsCard key={article.id} article={article} />
                ))}
              </div>
            )}

            {!loading && filtered.length === 0 && !error && (
              <div className="empty-state">
                <p>해당 카테고리에 뉴스가 없습니다.</p>
              </div>
            )}
          </>
        )}

        {activeTab === "workflow" && <ConstructionWorkflowBoard />}
      </main>
    </div>
  );
}
