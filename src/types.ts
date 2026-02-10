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

// Workflow types
export interface WorkflowResult {
  id: string;
  workflow_id: string;
  status: string;
  inputs: Record<string, unknown>;
  outputs: {
    "전체 결과": string;
    [key: string]: unknown;
  };
  error: string | null;
  total_steps: number;
  total_tokens: number;
  created_at: string | number;
  finished_at: string | number;
  elapsed_time: number;
}

export interface WorkflowError {
  error: string;
  code?: string;
  resolution: string;
}

export interface ParsedWorkflowData {
  constructionType?: string;
  scale?: string;
  budget?: string;
  features?: string[];
  technicalRequirements?: string[];
  recommendedVendors?: Array<{
    name: string;
    reason?: string;
    contact?: string;
    [key: string]: unknown;
  }>;
  contractInfo?: Record<string, unknown>;
  [key: string]: unknown;
}
