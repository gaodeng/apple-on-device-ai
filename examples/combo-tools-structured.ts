import { chat, structured } from "../src/apple-ai";
import { z } from "zod";

async function testToolsAndStructuredCombo() {
  console.log("🔧+📊 Testing Tool Calling + Structured Output Combination");
  console.log(
    "This tests the powerful combo of external data + structured formatting\n"
  );

  // Define some tools that provide external data
  const weatherTool = {
    name: "get_weather",
    description: "Get current weather for a location",
    jsonSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
      },
      required: ["location"],
    } as const,
    handler: async (args: Record<string, unknown>) => {
      const { location } = args as { location: string };
      // Simulate weather API call
      const conditions = ["sunny", "rainy", "cloudy", "snowy"];
      const temps = [72, 68, 45, 32];
      const randomIndex = Math.floor(Math.random() * conditions.length);

      return {
        location,
        temperature: temps[randomIndex],
        condition: conditions[randomIndex],
        humidity: Math.floor(Math.random() * 100),
        windSpeed: Math.floor(Math.random() * 20),
      };
    },
  };

  const stockTool = {
    name: "get_stock_price",
    description: "Get current stock price for a symbol",
    jsonSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol (e.g., AAPL)" },
      },
      required: ["symbol"],
    } as const,
    handler: async (args: Record<string, unknown>) => {
      const { symbol } = args as { symbol: string };
      // Simulate stock API call
      const basePrice = 150 + Math.random() * 100;
      const change = (Math.random() - 0.5) * 10;

      return {
        symbol: symbol.toUpperCase(),
        price: Math.round(basePrice * 100) / 100,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round((change / basePrice) * 100 * 100) / 100,
        volume: Math.floor(Math.random() * 1000000),
      };
    },
  };

  console.log("1️⃣ Testing: Tool call → Manual structured formatting");
  console.log(
    "   Call weather tool, then format response with structured generation\n"
  );

  try {
    // Step 1: Get weather data using tools
    const weatherResponse = await chat({
      messages: "Get the weather for San Francisco",
      tools: [weatherTool],
      temperature: 0.3,
    });

    console.log("🔧 Tool call result:", weatherResponse);

    if (weatherResponse.toolCalls && weatherResponse.toolCalls.length > 0) {
      // Step 2: Take the tool result and format it with structured output
      const WeatherReportSchema = z.object({
        location: z.string().describe("City name"),
        summary: z.string().describe("Brief weather summary"),
        details: z.object({
          temperature: z.number().describe("Temperature in Fahrenheit"),
          condition: z.string().describe("Weather condition"),
          humidity: z.number().describe("Humidity percentage"),
          comfort_level: z
            .enum(["very_cold", "cold", "mild", "warm", "hot"])
            .describe("Comfort level"),
        }),
        recommendations: z
          .array(z.string())
          .describe("Activity recommendations"),
      });

      const toolCallResult = weatherResponse.toolCalls[0];

      const structuredReport = await structured({
        prompt: `Format this weather data into a comprehensive report: ${JSON.stringify(
          toolCallResult
        )}`,
        schema: WeatherReportSchema,
        temperature: 0.7,
      });

      console.log("📊 Structured weather report:");
      console.log(JSON.stringify(structuredReport.object, null, 2));
    }
  } catch (error) {
    console.log("❌ Failed:", error);
  }

  console.log("\n" + "=".repeat(70) + "\n");

  console.log("2️⃣ Testing: Multiple tools → Aggregated structured output");
  console.log(
    "   Get multiple data sources, then create unified structured report\n"
  );

  try {
    // Get multiple data points
    const tasks = [
      chat({
        messages: "Get weather for New York",
        tools: [weatherTool],
        temperature: 0.3,
      }),
      chat({
        messages: "Get stock price for AAPL",
        tools: [stockTool],
        temperature: 0.3,
      }),
    ];

    const [weatherResult, stockResult] = await Promise.all(tasks);

    console.log("🔧 Multi-tool results:");
    console.log("Weather:", weatherResult);
    console.log("Stock:", stockResult);

    // Combine into structured daily brief
    const DailyBriefSchema = z.object({
      date: z.string().describe("Today's date"),
      weather_summary: z.string().describe("Weather overview"),
      market_summary: z.string().describe("Market overview"),
      key_metrics: z.object({
        temperature: z.number(),
        stock_price: z.number(),
        market_sentiment: z.enum(["bullish", "bearish", "neutral"]),
      }),
      daily_outlook: z.string().describe("Overall outlook for the day"),
      priority_actions: z.array(z.string()).describe("Recommended actions"),
    });

    const combinedData = {
      weather: weatherResult?.toolCalls?.[0] || {},
      stock: stockResult?.toolCalls?.[0] || {},
    };

    const dailyBrief = await structured({
      prompt: `Create a comprehensive daily brief from this data: ${JSON.stringify(
        combinedData
      )}`,
      schema: DailyBriefSchema,
      temperature: 0.8,
    });

    console.log("📊 Structured daily brief:");
    console.log(JSON.stringify(dailyBrief.object, null, 2));
  } catch (error) {
    console.log("❌ Failed:", error);
  }

  console.log("\n💡 Summary:");
  console.log("   • Tools provide external/dynamic data");
  console.log(
    "   • Structured generation formats that data into typed objects"
  );
  console.log("   • Combination creates powerful data processing pipelines");
  console.log(
    "   • Great for building intelligent reports, dashboards, and APIs"
  );
}

testToolsAndStructuredCombo().catch(console.error);
