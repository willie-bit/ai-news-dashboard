import { useState, useRef, useMemo } from "react";
import { useWorkflow } from "../hooks/useWorkflow";
import type { WorkflowResult } from "../types";

function FileUploadArea({
  files,
  onFilesChange,
  disabled,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files);
    onFilesChange([...files, ...dropped]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      onFilesChange([...files, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="wf-upload-section">
      <div
        className={`wf-dropzone ${dragOver ? "wf-dropzone-active" : ""} ${disabled ? "wf-dropzone-disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <div className="wf-dropzone-icon">+</div>
        <p className="wf-dropzone-text">
          구매요청서 파일을 드래그하거나 클릭하여 업로드
        </p>
        <p className="wf-dropzone-hint">
          PDF, DOCX, XLSX, CSV, HWP 등 지원
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: "none" }}
          accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.html,.pptx,.ppt,.xml,.hwp,.jpg,.jpeg,.png"
          disabled={disabled}
        />
      </div>

      {files.length > 0 && (
        <div className="wf-file-list">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="wf-file-item">
              <span className="wf-file-icon">
                {getFileIcon(file.name)}
              </span>
              <span className="wf-file-name">{file.name}</span>
              <span className="wf-file-size">
                {formatFileSize(file.size)}
              </span>
              {!disabled && (
                <button
                  className="wf-file-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["pdf"].includes(ext)) return "PDF";
  if (["docx", "doc"].includes(ext)) return "DOC";
  if (["xlsx", "xls"].includes(ext)) return "XLS";
  if (["csv"].includes(ext)) return "CSV";
  if (["pptx", "ppt"].includes(ext)) return "PPT";
  if (["jpg", "jpeg", "png", "gif"].includes(ext)) return "IMG";
  return "FILE";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function JsonTreeViewer({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (data === null || data === undefined) {
    return <span className="wf-json-null">null</span>;
  }

  if (typeof data === "boolean") {
    return (
      <span className="wf-json-bool">{data ? "true" : "false"}</span>
    );
  }

  if (typeof data === "number") {
    return <span className="wf-json-number">{data}</span>;
  }

  if (typeof data === "string") {
    // Try to parse as JSON for nested JSON strings
    if (data.startsWith("{") || data.startsWith("[")) {
      try {
        const parsed = JSON.parse(data);
        return <JsonTreeViewer data={parsed} depth={depth} />;
      } catch {
        // not JSON, render as string
      }
    }

    if (data.length > 200) {
      return (
        <span className="wf-json-string wf-json-long-string">
          &quot;{data}&quot;
        </span>
      );
    }
    return <span className="wf-json-string">&quot;{data}&quot;</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="wf-json-bracket">[]</span>;

    return (
      <span className="wf-json-array">
        <span
          className="wf-json-toggle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "+" : "-"}
        </span>
        <span className="wf-json-bracket">[</span>
        {collapsed ? (
          <span className="wf-json-collapsed" onClick={() => setCollapsed(false)}>
            {data.length}개 항목
          </span>
        ) : (
          <div className="wf-json-indent">
            {data.map((item, i) => (
              <div key={i} className="wf-json-line">
                <JsonTreeViewer data={item} depth={depth + 1} />
                {i < data.length - 1 && <span className="wf-json-comma">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="wf-json-bracket">]</span>
      </span>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="wf-json-bracket">{"{}"}</span>;

    return (
      <span className="wf-json-object">
        <span
          className="wf-json-toggle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "+" : "-"}
        </span>
        <span className="wf-json-bracket">{"{"}</span>
        {collapsed ? (
          <span className="wf-json-collapsed" onClick={() => setCollapsed(false)}>
            {entries.length}개 필드
          </span>
        ) : (
          <div className="wf-json-indent">
            {entries.map(([key, value], i) => (
              <div key={key} className="wf-json-line">
                <span className="wf-json-key">&quot;{key}&quot;</span>
                <span className="wf-json-colon">: </span>
                <JsonTreeViewer data={value} depth={depth + 1} />
                {i < entries.length - 1 && (
                  <span className="wf-json-comma">,</span>
                )}
              </div>
            ))}
          </div>
        )}
        <span className="wf-json-bracket">{"}"}</span>
      </span>
    );
  }

  return <span>{String(data)}</span>;
}

function ResultCards({ result }: { result: WorkflowResult }) {
  const outputText = result.outputs?.["전체 결과"] || "";

  // Try parsing the output as JSON
  const parsedOutput = useMemo(() => {
    if (!outputText) return null;
    try {
      return JSON.parse(outputText);
    } catch {
      return null;
    }
  }, [outputText]);

  // Extract sections from parsed output for card display
  const sections = useMemo(() => {
    if (!parsedOutput || typeof parsedOutput !== "object") return [];

    const result: Array<{ title: string; content: unknown }> = [];
    const data = parsedOutput as Record<string, unknown>;

    // Map common Korean keys to display sections
    const keyMapping: Record<string, string> = {
      "공사종류": "공사 종류",
      "공사_종류": "공사 종류",
      "constructionType": "공사 종류",
      "construction_type": "공사 종류",
      "규모": "공사 규모",
      "공사규모": "공사 규모",
      "공사_규모": "공사 규모",
      "scale": "공사 규모",
      "예산": "예산",
      "budget": "예산",
      "특징": "특징",
      "features": "특징",
      "기술적_요구사항": "기술적 요구사항",
      "기술적요구사항": "기술적 요구사항",
      "기술요구사항": "기술적 요구사항",
      "technicalRequirements": "기술적 요구사항",
      "technical_requirements": "기술적 요구사항",
      "추천업체": "추천 업체",
      "추천_업체": "추천 업체",
      "업체추천": "추천 업체",
      "업체_추천": "추천 업체",
      "recommendedVendors": "추천 업체",
      "recommended_vendors": "추천 업체",
      "계약정보": "계약 정보",
      "계약_정보": "계약 정보",
      "contractInfo": "계약 정보",
      "contract_info": "계약 정보",
    };

    for (const [key, value] of Object.entries(data)) {
      const displayTitle = keyMapping[key] || key;
      result.push({ title: displayTitle, content: value });
    }

    return result;
  }, [parsedOutput]);

  return (
    <div className="wf-results">
      {/* Summary stats */}
      <div className="wf-result-stats">
        <div className="wf-result-stat">
          <span className="wf-result-stat-value">{result.status === "succeeded" ? "성공" : "실패"}</span>
          <span className="wf-result-stat-label">실행 상태</span>
        </div>
        <div className="wf-result-stat">
          <span className="wf-result-stat-value">{result.total_steps}</span>
          <span className="wf-result-stat-label">처리 단계</span>
        </div>
        <div className="wf-result-stat">
          <span className="wf-result-stat-value">{result.elapsed_time?.toFixed(1)}s</span>
          <span className="wf-result-stat-label">소요 시간</span>
        </div>
        <div className="wf-result-stat">
          <span className="wf-result-stat-value">
            {new Date(result.created_at).toLocaleString("ko-KR", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="wf-result-stat-label">실행 시각</span>
        </div>
      </div>

      {/* Parsed result cards */}
      {sections.length > 0 && (
        <div className="wf-section-cards">
          {sections.map((section, i) => (
            <div key={i} className="wf-section-card">
              <h3 className="wf-section-title">{section.title}</h3>
              <div className="wf-section-content">
                {renderSectionContent(section.content)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raw JSON viewer */}
      <div className="wf-raw-json">
        <div className="wf-raw-json-header">
          <h3>JSON 원본 데이터</h3>
          <button
            className="wf-copy-btn"
            onClick={() => {
              const jsonStr = JSON.stringify(
                parsedOutput || result.outputs,
                null,
                2
              );
              navigator.clipboard.writeText(jsonStr);
            }}
          >
            복사
          </button>
        </div>
        <div className="wf-json-viewer">
          <pre className="wf-json-pre">
            <JsonTreeViewer data={parsedOutput || result.outputs} />
          </pre>
        </div>
      </div>
    </div>
  );
}

function renderSectionContent(content: unknown): JSX.Element {
  if (content === null || content === undefined) {
    return <p className="wf-text-muted">정보 없음</p>;
  }

  if (typeof content === "string") {
    return <p className="wf-section-text">{content}</p>;
  }

  if (typeof content === "number" || typeof content === "boolean") {
    return <p className="wf-section-text">{String(content)}</p>;
  }

  if (Array.isArray(content)) {
    // Check if it's an array of objects (like vendors)
    if (content.length > 0 && typeof content[0] === "object" && content[0] !== null) {
      return (
        <div className="wf-table-container">
          <table className="wf-table">
            <thead>
              <tr>
                {Object.keys(content[0] as Record<string, unknown>).map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.map((item, i) => (
                <tr key={i}>
                  {Object.values(item as Record<string, unknown>).map((val, j) => (
                    <td key={j}>{typeof val === "object" ? JSON.stringify(val) : String(val ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // Simple array of primitives
    return (
      <ul className="wf-list">
        {content.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }

  if (typeof content === "object") {
    const entries = Object.entries(content as Record<string, unknown>);
    return (
      <div className="wf-key-value-list">
        {entries.map(([key, value]) => (
          <div key={key} className="wf-key-value-item">
            <span className="wf-kv-key">{key}</span>
            <span className="wf-kv-value">
              {typeof value === "object"
                ? JSON.stringify(value, null, 2)
                : String(value ?? "")}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return <p>{String(content)}</p>;
}

export function ConstructionWorkflowBoard() {
  const [files, setFiles] = useState<File[]>([]);
  const { result, loading, error, runWorkflow, reset } = useWorkflow();
  const [viewMode, setViewMode] = useState<"cards" | "json">("cards");

  const handleSubmit = async () => {
    if (files.length === 0) return;
    await runWorkflow(files);
  };

  const handleReset = () => {
    setFiles([]);
    reset();
  };

  return (
    <div className="wf-board">
      <div className="wf-board-header">
        <div>
          <h2 className="wf-board-title">공사 워크플로우 분석 보드</h2>
          <p className="wf-board-desc">
            구매요청서를 업로드하면 AI가 공사 종류, 규모, 예산, 기술적
            요구사항을 분석하고 추천 업체를 제안합니다.
          </p>
        </div>
        {result && (
          <div className="wf-view-toggle">
            <button
              className={`wf-toggle-btn ${viewMode === "cards" ? "active" : ""}`}
              onClick={() => setViewMode("cards")}
            >
              카드 뷰
            </button>
            <button
              className={`wf-toggle-btn ${viewMode === "json" ? "active" : ""}`}
              onClick={() => setViewMode("json")}
            >
              JSON 뷰
            </button>
          </div>
        )}
      </div>

      {/* Upload section */}
      {!result && (
        <FileUploadArea
          files={files}
          onFilesChange={setFiles}
          disabled={loading}
        />
      )}

      {/* Actions */}
      <div className="wf-actions">
        {!result && (
          <button
            className="wf-submit-btn"
            onClick={handleSubmit}
            disabled={files.length === 0 || loading}
          >
            {loading ? (
              <>
                <span className="wf-btn-spinner" />
                분석 중...
              </>
            ) : (
              "워크플로우 실행"
            )}
          </button>
        )}
        {(result || error) && (
          <button className="wf-reset-btn" onClick={handleReset}>
            새로운 분석
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="wf-loading">
          <div className="spinner" />
          <p>AI 워크플로우가 구매요청서를 분석하고 있습니다...</p>
          <p className="wf-loading-hint">
            공사 종류, 규모, 예산, 기술적 요구사항 분석 및 업체 추천 진행 중
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="wf-error">
          <div className="wf-error-icon">!</div>
          <div className="wf-error-content">
            <p className="wf-error-message">{error.error}</p>
            {error.code && (
              <p className="wf-error-code">오류 코드: {error.code}</p>
            )}
            <p className="wf-error-resolution">{error.resolution}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {viewMode === "cards" ? (
            <ResultCards result={result} />
          ) : (
            <div className="wf-raw-json">
              <div className="wf-raw-json-header">
                <h3>전체 JSON 응답</h3>
                <button
                  className="wf-copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      JSON.stringify(result, null, 2)
                    );
                  }}
                >
                  복사
                </button>
              </div>
              <div className="wf-json-viewer">
                <pre className="wf-json-pre">
                  <JsonTreeViewer data={result} />
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
