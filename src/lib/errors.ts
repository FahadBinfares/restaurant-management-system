import { ApiError } from "./api";
import { ERROR_MESSAGES } from "./labels";

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return ERROR_MESSAGES[error.code] ?? error.message;
  return "حدث خطأ غير متوقع. حاول مرة أخرى";
}
