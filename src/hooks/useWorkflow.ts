import { useState, useCallback } from "react";
import type { WorkflowResult, WorkflowError } from "../types";

interface UseWorkflowReturn {
  result: WorkflowResult | null;
  loading: boolean;
  error: WorkflowError | null;
  runWorkflow: (files: File[]) => Promise<void>;
  reset: () => void;
}

export function useWorkflow(): UseWorkflowReturn {
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<WorkflowError | null>(null);

  const runWorkflow = useCallback(async (files: File[]) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/workflow/run", {
        method: "POST",
        body: formData,
      });

      const raw = await response.json();

      if (!response.ok) {
        setError(raw as WorkflowError);
        return;
      }

      // MISO API가 { data: { ... } } 형태로 응답할 수 있음
      const data = raw.data || raw;
      setResult(data as WorkflowResult);
    } catch (err) {
      setError({
        error:
          err instanceof Error
            ? err.message
            : "워크플로우 실행 중 오류가 발생했습니다.",
        resolution: "네트워크 연결을 확인하고 다시 시도해주세요.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return { result, loading, error, runWorkflow, reset };
}
