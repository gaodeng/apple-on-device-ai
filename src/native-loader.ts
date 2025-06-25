import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ESM compatibility
let __dirname: string;
let require: NodeJS.Require;

try {
  // Try to use global __dirname if available (CommonJS)
  __dirname =
    (globalThis as any).__dirname || dirname(fileURLToPath(import.meta.url));
} catch {
  __dirname = dirname(fileURLToPath(import.meta.url));
}

try {
  // Try to use global require if available (CommonJS)
  require = (globalThis as any).require || createRequire(import.meta.url);
} catch {
  require = createRequire(import.meta.url);
}

/**
 * Robust native module loader for Apple AI FFI components
 * Handles both development and production/bundled scenarios
 */
export function loadNativeModule(): any {
  // Multiple possible locations for the native addon
  // Order is important - try most likely locations first
  const possiblePaths = [
    // 1. Bundled in published npm package (most common for end users)
    resolve(__dirname, "../build/apple_ai_napi.node"),

    // 2. Installed as dependency
    resolve(
      process.cwd(),
      "node_modules/@meridius-labs/apple-on-device-ai/build/apple_ai_napi.node"
    ),

    // 3. Development scenarios
    resolve(__dirname, "../../build/apple_ai_napi.node"),
    resolve(__dirname, "../native/target/release/apple_ai_napi.node"),
    resolve(__dirname, "../../native/target/release/apple_ai_napi.node"),

    // 4. Legacy/fallback paths
    resolve(__dirname, "../native/target/release/libapple_ai_napi.dylib"),
    resolve(__dirname, "../../native/target/release/libapple_ai_napi.dylib"),
    resolve(process.cwd(), "build/apple_ai_napi.node"),
  ];

  let lastError: Error | null = null;

  // First, try to find an existing file
  const existingPath = possiblePaths.find((path) => {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  });

  if (existingPath) {
    try {
      return require(existingPath);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  // If no file found, try all paths anyway (in case of symlinks, etc.)
  for (const path of possiblePaths) {
    try {
      return require(path);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  // Enhanced error message with debugging info
  const errorDetails = [
    `Failed to load apple_ai_napi native module.`,
    `Searched paths:`,
    ...possiblePaths.map(
      (p) => `  - ${p} ${existsSync(p) ? "(exists)" : "(not found)"}`
    ),
    ``,
    `Platform: ${process.platform} ${process.arch}`,
    `Node version: ${process.version}`,
    `Working directory: ${process.cwd()}`,
    `Script location: ${__dirname}`,
    ``,
    `Last error: ${lastError?.message || "Unknown error"}`,
    ``,
    `This package requires:`,
    `- macOS 26+ (current: ${process.platform})`,
    `- Apple Silicon (ARM64) (current: ${process.arch})`,
  ].join("\n");

  throw new Error(errorDetails);
}

// Global native module instance
let nativeModule: any = null;

/**
 * Get the native module instance (singleton)
 */
export function getNativeModule(): any {
  if (!nativeModule) {
    nativeModule = loadNativeModule();
  }
  return nativeModule;
}
