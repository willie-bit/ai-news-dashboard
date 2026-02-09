interface HeaderProps {
  lastUpdated: number;
  onRefresh: () => void;
  loading: boolean;
}

export function Header({ lastUpdated, onRefresh, loading }: HeaderProps) {
  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";

  return (
    <header className="header">
      <div className="header-content">
        <div className="header-title">
          <h1>AI News Dashboard</h1>
          <p className="subtitle">AI 관련 최신 뉴스를 한눈에 확인하세요</p>
        </div>
        <div className="header-actions">
          <span className="last-updated">마지막 업데이트: {formattedTime}</span>
          <button
            className="refresh-btn"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "로딩 중..." : "새로고침"}
          </button>
        </div>
      </div>
    </header>
  );
}
