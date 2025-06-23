import { appleAI } from "@meridius-labs/apple-on-device-ai";
import {
  stepCountIs,
  streamText,
  tool,
  type ToolCallPart,
  type ToolResultPart,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import chalk from "chalk";
import readline from "readline";
import ora from "ora";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import boxen from "boxen";

// Configure marked to use terminal renderer
marked.setOptions({
  // @ts-ignore
  renderer: new TerminalRenderer({
    // Custom theme for better readability
    firstHeading: chalk.magenta.bold,
    heading: chalk.magenta.bold,
    blockquote: chalk.gray.italic,
    code: chalk.cyan,
    codespan: chalk.cyan,
    strong: chalk.bold,
    em: chalk.italic,
    link: chalk.blue.underline,
    list: chalk.reset,
    listitem: chalk.reset,
    paragraph: chalk.reset,
    tab: 2,
    unescape: true,
  }),
});

function formatStatus(
  message: string,
  type: "info" | "success" | "error" = "info"
): string {
  const colors = {
    info: chalk.dim,
    success: chalk.green,
    error: chalk.red,
  };
  return `  ${colors[type](message)}`;
}

// Simple, reliable geocoding using Nominatim (OpenStreetMap)
async function getCoordinates(location: string) {
  const sanitizedLocation = location.trim().replace(/\s+/g, " ");

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        sanitizedLocation
      )}&format=json&limit=1&addressdetails=1`,
      {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Apple-AI-Chat/1.0" },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      address?: { country?: string };
    }>;

    if (!data[0]) {
      return null;
    }

    return {
      latitude: parseFloat(data[0].lat),
      longitude: parseFloat(data[0].lon),
      name: data[0].display_name?.split(",")[0]?.trim() || "Unknown",
      country: data[0].address?.country || "Unknown",
    };
  } catch (error) {
    console.log(
      formatStatus(
        `Geocoding failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      )
    );
    return null;
  }
}

async function getWeather(lat: number, lon: number) {
  if (!lat || !lon) {
    throw new Error("Invalid latitude or longitude");
  }

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
  );
  return (await response.json()) as {
    current: {
      temperature_2m: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
    };
  };
}

// Get user's location from IP address
async function getUserLocationFromIP() {
  try {
    const response = await fetch("http://ip-api.com/json/");
    const data = (await response.json()) as {
      status: string;
      city: string;
      regionName: string;
      country: string;
      lat: number;
      lon: number;
    };

    if (data.status === "success") {
      return {
        city: data.city,
        region: data.regionName,
        country: data.country,
        latitude: data.lat,
        longitude: data.lon,
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

function displayWelcome() {
  // Use boxen for a styled welcome box

  console.log(
    boxen(
      `Apple Foundation Models (${chalk.greenBright("Bun")} + ${chalk.blue(
        "Apple Intelligence"
      )})`,
      {
        padding: { top: 0, bottom: 0, left: 4, right: 4 },

        borderStyle: "round",
        borderColor: "cyan",
      }
    )
  );
}

function formatToolCall(toolName: string, input: any): string {
  // Ensure clean string formatting to prevent corruption
  const inputStr =
    typeof input === "object"
      ? JSON.stringify(input).replace(/[^\x20-\x7E]/g, "") // Remove non-ASCII chars
      : String(input).replace(/[^\x20-\x7E]/g, "");
  return chalk.dim(`[tool] ${chalk.yellow("↓")} ${toolName}: ${inputStr}`);
}

const messages: ModelMessage[] = [
  {
    role: "system",
    content: `You are a helpful assistant with a friendly personality, created by Apple. Use emojis occasionally to make conversations more engaging.
Do NOT use markdown. This is a terminal environment, so use plain text. Emojis are allowed.`,
  },
];

// Simple input that keeps everything on one line
async function getInput(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.cyan("› "), (answer) => {
      // Move cursor up and rewrite the line with gray text
      process.stdout.write("\x1B[1A\x1B[2K");
      console.log(chalk.cyan("› ") + chalk.gray(answer));
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.clear();
  displayWelcome();

  // Main chat loop
  for (;;) {
    const userInput = await getInput();

    if (!userInput.trim()) continue;

    if (
      userInput.toLowerCase() === "quit" ||
      userInput.toLowerCase() === "exit" ||
      userInput.toLowerCase() === "/q"
    ) {
      console.log(chalk.dim("\nBye!\n"));
      process.exit(0);
    }

    // Don't display user message - they already see what they typed
    messages.push({ role: "user", content: userInput });

    // Start thinking spinner
    const spinner = ora({
      text: chalk.dim("thinking"),
      spinner: "dots",
      color: "cyan",
      indent: 2,
    }).start();

    try {
      const { fullStream } = streamText({
        // temperature: 0.9,
        model: appleAI("apple-intelligence"),
        messages: messages,
        stopWhen: stepCountIs(8),
        tools: {
          time: tool({
            description: "Use this tool to get the current time.",
            inputSchema: z.object({}),
            async execute(input) {
              spinner.stop();
              console.log(formatToolCall("time", ""));
              return new Date().toLocaleTimeString();
            },
          }),
          convert_to_celsius: tool({
            description:
              "Use this tool if user asks to convert a temperature to Celsius.",
            inputSchema: z.object({
              temperature: z
                .number()
                .describe("The fahrenheit temperature to convert"),
            }),
            async execute(input) {
              spinner.stop();
              console.log(formatToolCall("convert", input));

              const toolSpinner = ora({
                text: chalk.dim("converting"),
                spinner: "dots",
                color: "yellow",
                indent: 4,
              }).start();

              const celsius = (((input.temperature - 32) * 5) / 9).toFixed(1);

              toolSpinner.succeed(
                chalk.green(`${input.temperature}°F = ${celsius}°C`)
              );

              return `${celsius}°C`;
            },
          }),

          weather: tool({
            description: "Use this tool to get the weather for a location.",
            inputSchema: z.object({
              location_optional_not_required: z
                .string()
                .optional()
                .describe("The location to get weather for"),
            }),
            async execute(input) {
              spinner.stop();

              let locationToUse = input.location_optional_not_required;

              // If no location provided, auto-detect from IP
              if (!locationToUse) {
                console.log(formatToolCall("location", "detecting from IP"));

                const locationSpinner = ora({
                  text: chalk.dim("detecting location"),
                  spinner: "dots",
                  color: "yellow",
                  indent: 4,
                }).start();

                try {
                  const autoLocation = await getUserLocationFromIP();

                  if (!autoLocation) {
                    locationSpinner.fail(
                      chalk.red("Could not detect location")
                    );
                    return "Unable to detect your location. Please specify a location for weather.";
                  }

                  locationSpinner.succeed(
                    chalk.green(`${autoLocation.city}, ${autoLocation.region}`)
                  );
                  locationToUse = `${autoLocation.city}, ${autoLocation.region}`;
                } catch (error) {
                  locationSpinner.fail(chalk.red("Location detection failed"));
                  return "Failed to detect your location. Please specify a location for weather.";
                }
              }

              console.log(formatToolCall("weather", locationToUse));

              const toolSpinner = ora({
                text: chalk.dim("fetching weather"),
                spinner: "dots",
                color: "yellow",
                indent: 4,
              }).start();

              try {
                const coordinates = await getCoordinates(locationToUse);

                if (!coordinates) {
                  toolSpinner.fail(
                    chalk.red(`Location "${locationToUse}" not found`)
                  );
                  return `Location "${locationToUse}" not found`;
                }

                // Get weather data
                const weatherData = await getWeather(
                  coordinates.latitude,
                  coordinates.longitude
                );
                const current = weatherData.current;

                // Simplified weather codes
                const weatherCodeMap: { [key: number]: string } = {
                  0: "clear",
                  1: "mostly clear",
                  2: "partly cloudy",
                  3: "overcast",
                  45: "foggy",
                  51: "drizzle",
                  61: "rain",
                  71: "snow",
                  80: "showers",
                  95: "storm",
                };

                const weatherDescription =
                  weatherCodeMap[Math.floor(current.weather_code / 10) * 10] ||
                  weatherCodeMap[current.weather_code] ||
                  "unknown";

                toolSpinner.succeed(
                  chalk.green(`${coordinates.name}, ${coordinates.country}`)
                );

                return `${coordinates.name}: ${current.temperature_2m}°F, ${weatherDescription}, ${current.relative_humidity_2m}% humidity, ${current.wind_speed_10m}mph wind`;
              } catch (error) {
                toolSpinner.fail(chalk.red("Error getting weather"));
                return `Error getting weather for "${locationToUse}"`;
              }
            },
          }),
        },
      });

      let assistantResponse = "";
      let firstChunk = true;
      // Benchmarking variables
      let tokenCount = 0;
      let streamStart = Date.now();
      let streamEnd = streamStart;
      let gotFirstToken = false;
      const toolCalls: ToolCallPart[] = [];
      const toolResponses: ToolResultPart[] = [];

      // Helper for typewriter effect
      async function typewriter(text: string, delay = 10) {
        for (const char of text) {
          if (!gotFirstToken) {
            streamStart = Date.now();
            gotFirstToken = true;
          }
          process.stdout.write(chalk.reset(char));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      for await (const chunk of fullStream) {
        if (firstChunk) {
          spinner.stop();
          firstChunk = false;
        }
        // Stream each chunk directly without additional processing
        if (chunk.type === "text") {
          await typewriter(chunk.text);
          assistantResponse += chunk.text;
          // Count tokens (simple whitespace split)
          tokenCount += chunk.text.split(/\s+/).filter(Boolean).length;
        } else if (chunk.type === "tool-result") {
          toolResponses.push(chunk satisfies ToolResultPart);
        } else if (chunk.type === "tool-call") {
          toolCalls.push(chunk satisfies ToolCallPart);
        }
      }
      streamEnd = Date.now();

      console.log("\n"); // Newline after streaming

      // Display streaming speed benchmark (subtle, compact)
      if (tokenCount > 0) {
        const seconds = (streamEnd - streamStart) / 1000;
        const tps = tokenCount / (seconds || 1e-6); // Avoid div by zero
        const speedMsg = chalk.dim(
          `  · ${seconds.toFixed(2)}s · ${tps.toFixed(2)} t/s\n`
        );
        console.log(speedMsg);
      }

      if (toolResponses.length > 0) {
        messages.push({ role: "tool", content: toolResponses });
      }

      if (assistantResponse.trim()) {
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: assistantResponse }, ...toolCalls],
        });
      }
    } catch (error) {
      spinner.fail(chalk.red("Error occurred"));
      console.log("");
    }
  }
}

// Handle graceful exit
process.on("SIGINT", () => {
  console.log(chalk.dim("\n\nBye!\n"));
  process.exit(0);
});

main().catch(console.error);
