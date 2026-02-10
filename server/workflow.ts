import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

const MISO_API_BASE = "https://api.holdings.miso.gs/ext/v1";

function getApiKey(): string {
  const key = process.env.MISO_API_KEY;
  if (!key) {
    throw new Error("MISO_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  return key;
}

// Configure multer for temp file storage
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Upload file to MISO and get upload_file_id
async function uploadFileToMiso(
  filePath: string,
  originalName: string,
  apiKey: string
): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);

  const formData = new FormData();
  formData.append("file", blob, originalName);
  formData.append("user", "construction-workflow-user");

  const response = await fetch(`${MISO_API_BASE}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`파일 업로드 실패 (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

// Run the MISO workflow
async function runWorkflow(
  fileIds: Array<{ upload_file_id: string; type: string }>,
  apiKey: string
): Promise<Record<string, unknown>> {
  const fileList = fileIds.map((f) => ({
    type: f.type,
    transfer_method: "local_file",
    upload_file_id: f.upload_file_id,
  }));

  const body = {
    inputs: {
      procurment_documnet: fileList,
    },
    files: [],
    mode: "blocking",
    user: "construction-workflow-user",
  };

  const response = await fetch(`${MISO_API_BASE}/workflows/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    const errorMessage = errorData?.message || response.statusText;
    const errorCode = errorData?.code || response.status;

    let resolution = "";
    switch (errorCode) {
      case "invalid_param":
        resolution =
          "입력 파라미터를 확인해주세요. 앱이 발행되지 않은 경우, 미소 앱 편집화면에서 저장버튼을 눌러주세요.";
        break;
      case "app_unavailable":
        resolution = "앱 설정 정보를 확인해주세요.";
        break;
      case "provider_not_initialize":
        resolution = "모델 인증 정보를 확인해주세요.";
        break;
      case "provider_quota_exceeded":
        resolution = "모델 호출 쿼터가 초과되었습니다. 잠시 후 다시 시도해주세요.";
        break;
      case "model_currently_not_support":
        resolution = "현재 모델을 사용할 수 없습니다. 다른 모델로 변경해주세요.";
        break;
      case "workflow_request_error":
        resolution = "워크플로우 실행에 실패했습니다. 워크플로우 설정을 확인해주세요.";
        break;
      default:
        resolution = "잠시 후 다시 시도해주세요.";
    }

    throw new Error(
      JSON.stringify({
        error: errorMessage,
        code: errorCode,
        resolution,
        status: response.status,
      })
    );
  }

  return (await response.json()) as Record<string, unknown>;
}

function getFileType(
  filename: string
): "document" | "image" | "audio" | "video" | "custom" {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const docExts = [
    "txt",
    "md",
    "markdown",
    "pdf",
    "html",
    "xlsx",
    "xls",
    "docx",
    "csv",
    "eml",
    "msg",
    "pptx",
    "ppt",
    "xml",
    "epub",
  ];
  const imgExts = ["jpg", "jpeg", "png", "gif", "webp", "svg"];
  const audioExts = ["mp3", "m4a", "wav", "webm", "amr"];
  const videoExts = ["mp4", "mov", "mpeg", "mpga"];

  if (docExts.includes(ext)) return "document";
  if (imgExts.includes(ext)) return "image";
  if (audioExts.includes(ext)) return "audio";
  if (videoExts.includes(ext)) return "video";
  return "custom";
}

// POST /api/workflow/run - Upload files and run the workflow
router.post(
  "/run",
  upload.array("files", 10),
  async (req: Request, res: Response) => {
    let tempFiles: string[] = [];

    try {
      const apiKey = getApiKey();
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        res.status(400).json({
          error: "파일이 첨부되지 않았습니다.",
          resolution: "구매요청서 파일을 업로드해주세요.",
        });
        return;
      }

      tempFiles = files.map((f) => f.path);

      // Upload each file to MISO
      const uploadResults = await Promise.all(
        files.map(async (file) => {
          const uploadId = await uploadFileToMiso(
            file.path,
            file.originalname,
            apiKey
          );
          return {
            upload_file_id: uploadId,
            type: getFileType(file.originalname),
            originalName: file.originalname,
          };
        })
      );

      // Run the workflow
      const result = await runWorkflow(uploadResults, apiKey);
      res.json(result);
    } catch (error) {
      console.error("Workflow execution failed:", error);

      let errorResponse;
      try {
        errorResponse = JSON.parse((error as Error).message);
      } catch {
        errorResponse = {
          error: (error as Error).message,
          resolution: "잠시 후 다시 시도해주세요.",
        };
      }

      const status = errorResponse.status || 500;
      delete errorResponse.status;
      res.status(status).json(errorResponse);
    } finally {
      // Cleanup temp files
      for (const filePath of tempFiles) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
);

export default router;
