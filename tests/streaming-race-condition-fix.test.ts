import { test, expect } from "bun:test";
import { chat, appleAISDK } from "../src/apple-ai";

/**
 * Tests for streaming race condition fix
 *
 * Issue: When Swift signals end-of-stream (ptr.is_null()), the Rust code was
 * calling state.tsfn.clone().abort() too early, creating a race condition where
 * the threadsafe function was aborted before the JavaScript callback could
 * process the end-of-stream signal.
 *
 * Fix: Removed the immediate abort() call and let the callback complete naturally.
 */

test("streaming should complete without hanging", async () => {
  const availability = await appleAISDK.checkAvailability();
  if (!availability.available) {
    console.log("Skipping test: Apple Intelligence not available");
    return;
  }

  // Test with timeout to catch hanging streams
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("Stream did not complete within 15 seconds"));
    }, 15000);
  });

  const streamPromise = async () => {
    let chunkCount = 0;
    const chunks: string[] = [];

    const stream = chat({
      messages: "Say hello",
      stream: true,
      temperature: 0.1,
    });

    for await (const chunk of stream) {
      chunkCount++;
      chunks.push(chunk);

      // Safety check to prevent infinite loops in case of other issues
      if (chunkCount > 100) {
        throw new Error("Too many chunks received");
      }
    }

    return { chunkCount, totalLength: chunks.join("").length };
  };

  const result = (await Promise.race([streamPromise(), timeoutPromise])) as {
    chunkCount: number;
    totalLength: number;
  };

  expect(result.chunkCount).toBeGreaterThan(0);
  expect(result.totalLength).toBeGreaterThan(0);
}, 20000);

test("multiple sequential streams should all complete", async () => {
  const availability = await appleAISDK.checkAvailability();
  if (!availability.available) {
    console.log("Skipping test: Apple Intelligence not available");
    return;
  }

  const numStreams = 3;
  const results: number[] = [];

  for (let i = 0; i < numStreams; i++) {
    const stream = chat({
      messages: `Test ${i + 1}`,
      stream: true,
      temperature: 0.0,
    });

    let chunkCount = 0;
    for await (const _chunk of stream) {
      chunkCount++;
      if (chunkCount > 50) break; // Safety limit
    }

    results.push(chunkCount);
  }

  expect(results).toHaveLength(numStreams);

  for (const chunkCount of results) {
    expect(chunkCount).toBeGreaterThan(0);
  }
}, 60000);
