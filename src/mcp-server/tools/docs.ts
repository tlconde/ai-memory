import { resolve } from "path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  loadDocsSchema,
  getDocPath,
  validateDocPlacement,
  listDocTypes,
} from "../../docs-schema.js";
import { textResponse, type McpResponse } from "./shared.js";

export async function handleGetDocPath(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const docType = args.type;
  if (typeof docType !== "string" || !docType.trim()) {
    throw new McpError(ErrorCode.InvalidParams, "type is required.");
  }
  const projectRoot = resolve(aiDir, "..");
  const schema = await loadDocsSchema(projectRoot);
  if (!schema) return textResponse("No .ai/docs-schema.json found. Run `ai-memory init --full` to create one.");

  const slug = typeof args.slug === "string" ? args.slug : undefined;
  let path: string | null;
  try {
    path = getDocPath(schema, docType, slug);
  } catch (err) {
    if (err instanceof Error && err.message.includes("slug")) {
      throw new McpError(ErrorCode.InvalidParams, err.message);
    }
    throw err;
  }
  if (!path) {
    return textResponse(`Unknown doc type "${docType}". Available: ${Object.keys(schema.docTypes).join(", ")}`);
  }
  return textResponse(path);
}

export async function handleValidateDocPlacement(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const projectRoot = resolve(aiDir, "..");
  const schema = await loadDocsSchema(projectRoot);
  if (!schema) return textResponse("valid: true (no schema)");

  const pathsToCheck: string[] = [];
  if (typeof args.path === "string" && args.path) pathsToCheck.push(args.path);
  if (Array.isArray(args.paths)) pathsToCheck.push(...(args.paths as string[]).filter((p): p is string => typeof p === "string"));
  if (pathsToCheck.length === 0) return textResponse("Provide path or paths to validate.");

  const allErrors: string[] = [];
  for (const p of pathsToCheck) {
    const result = validateDocPlacement(schema, p, projectRoot);
    if (!result.valid) allErrors.push(...result.errors.map((e) => `${p}: ${e}`));
  }
  const valid = allErrors.length === 0;
  const text = valid
    ? `valid: true (${pathsToCheck.length} path(s) OK)`
    : `valid: false\n${allErrors.join("\n")}`;
  return textResponse(text);
}

export async function handleListDocTypes(aiDir: string): Promise<McpResponse> {
  const projectRoot = resolve(aiDir, "..");
  const schema = await loadDocsSchema(projectRoot);
  if (!schema) return textResponse("No .ai/docs-schema.json found.");
  const types = listDocTypes(schema);
  const text = types.map((t) => `- ${t.type}: ${t.path}/${t.pattern}`).join("\n");
  return textResponse(text || "No doc types defined.");
}
