import type { ErrorBody } from "../types";

export function errorBody(message: string): ErrorBody {
  return { success: false, message };
}
