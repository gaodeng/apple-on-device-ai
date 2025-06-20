import { structured, appleAISDK } from "../src/apple-ai";
import { z } from "zod";

async function debugStructured() {
  console.log("🔍 Debugging Structured Generation");

  // First, check basic availability
  console.log("\n1️⃣ Checking Apple Intelligence availability:");
  const availability = await appleAISDK.checkAvailability();
  console.log(`Available: ${availability.available}`);
  console.log(`Reason: ${availability.reason}`);

  if (!availability.available) {
    console.log("❌ Apple Intelligence not available - stopping debug");
    return;
  }

  // Test basic non-structured generation first
  console.log("\n2️⃣ Testing basic generation:");
  try {
    const basicResponse = await appleAISDK.generateResponse(
      "Say hello in one word",
      { temperature: 0.7 }
    );
    console.log(`✅ Basic generation works: "${basicResponse}"`);
  } catch (error) {
    console.log(`❌ Basic generation failed: ${error}`);
    return;
  }

  // Test with a very simple schema
  console.log("\n3️⃣ Testing simple structured generation:");
  const SimpleSchema = z.object({
    greeting: z.string().describe("A simple greeting"),
  });

  try {
    console.log(
      "Schema being sent:",
      JSON.stringify(
        {
          type: "object",
          properties: {
            greeting: { type: "string", description: "A simple greeting" },
          },
          required: ["greeting"],
        },
        null,
        2
      )
    );

    const simpleResult = await structured({
      prompt: "Generate a simple greeting",
      schema: SimpleSchema,
      temperature: 0.7,
    });
    console.log(`✅ Simple structured generation works:`, simpleResult);
  } catch (error) {
    console.log(`❌ Simple structured generation failed:`);
    console.log(`Error type: ${typeof error}`);
    console.log(`Error message: ${error}`);
    console.log(`Error stack:`, (error as Error).stack);

    // Let's try calling the underlying method directly to see the raw response
    console.log("\n4️⃣ Testing raw generateStructured call:");
    try {
      const rawResult = await appleAISDK.generateStructured({
        prompt: "Generate a simple greeting",
        schemaJson: JSON.stringify({
          type: "object",
          properties: {
            greeting: { type: "string", description: "A simple greeting" },
          },
          required: ["greeting"],
        }),
        temperature: 0.7,
      });
      console.log(`✅ Raw call works:`, rawResult);
    } catch (rawError) {
      console.log(`❌ Raw call failed: ${rawError}`);
    }
  }

  // Test the exact schema that was failing
  console.log("\n5️⃣ Testing the failing PersonSchema:");
  const PersonSchema = z.object({
    name: z.string().describe("Person's name"),
    age: z.number().describe("Person's age"),
    occupation: z.string().describe("Person's job"),
  });

  try {
    console.log(
      "PersonSchema being sent:",
      JSON.stringify(
        {
          type: "object",
          properties: {
            name: { type: "string", description: "Person's name" },
            age: { type: "number", description: "Person's age" },
            occupation: { type: "string", description: "Person's job" },
          },
          required: ["name", "age", "occupation"],
        },
        null,
        2
      )
    );

    const personResult = await structured({
      prompt: "Generate a profile for a fictional software engineer",
      schema: PersonSchema,
      temperature: 0.8,
    });
    console.log(`✅ PersonSchema works:`, personResult);
  } catch (error) {
    console.log(`❌ PersonSchema failed:`);
    console.log(`Error: ${error}`);

    // Try with different temperature
    console.log("\n🔄 Retrying with temperature 0.3:");
    try {
      const retryResult = await structured({
        prompt: "Generate a profile for a fictional software engineer",
        schema: PersonSchema,
        temperature: 0.3,
      });
      console.log(`✅ Lower temperature works:`, retryResult);
    } catch (retryError) {
      console.log(`❌ Lower temperature also failed: ${retryError}`);

      // Try with even simpler prompt
      console.log("\n🔄 Retrying with simpler prompt:");
      try {
        const simplePromptResult = await structured({
          prompt: "Create a person with name, age and job",
          schema: PersonSchema,
          temperature: 0.3,
        });
        console.log(`✅ Simpler prompt works:`, simplePromptResult);
      } catch (simpleError) {
        console.log(`❌ Simpler prompt also failed: ${simpleError}`);
      }
    }
  }

  // Test hypothesis: numbers cause issues
  console.log("\n6️⃣ Testing number type hypothesis:");

  // Test 1: Just strings
  const StringOnlySchema = z.object({
    name: z.string().describe("Person's name"),
    occupation: z.string().describe("Person's job"),
  });

  try {
    const stringResult = await structured({
      prompt: "Generate a person with name and job",
      schema: StringOnlySchema,
      temperature: 0.3,
    });
    console.log(`✅ String-only schema works:`, stringResult.object);
  } catch (error) {
    console.log(`❌ String-only schema failed: ${error}`);
  }

  // Test 2: Just one number
  const OneNumberSchema = z.object({
    name: z.string().describe("Person's name"),
    age: z.number().describe("Person's age"),
  });

  try {
    const oneNumberResult = await structured({
      prompt: "Generate a person with name and age",
      schema: OneNumberSchema,
      temperature: 0.3,
    });
    console.log(`✅ One number schema works:`, oneNumberResult.object);
  } catch (error) {
    console.log(`❌ One number schema failed: ${error}`);
  }

  // Test 3: Just a number field
  const JustNumberSchema = z.object({
    age: z.number().describe("A person's age"),
  });

  try {
    const justNumberResult = await structured({
      prompt: "Generate an age number",
      schema: JustNumberSchema,
      temperature: 0.3,
    });
    console.log(`✅ Just number schema works:`, justNumberResult.object);
  } catch (error) {
    console.log(`❌ Just number schema failed: ${error}`);
  }

  // Test 4: Integer instead of number
  const IntegerSchema = z.object({
    name: z.string().describe("Person's name"),
    age: z.number().int().describe("Person's age as integer"),
  });

  try {
    const integerResult = await structured({
      prompt: "Generate a person with name and integer age",
      schema: IntegerSchema,
      temperature: 0.3,
    });
    console.log(`✅ Integer schema works:`, integerResult.object);
  } catch (error) {
    console.log(`❌ Integer schema failed: ${error}`);
  }

  // Test exact boundaries
  console.log("\n7️⃣ Testing exact boundaries:");

  // Test: Two strings + one number (3 total)
  const TwoStringsOneNumberSchema = z.object({
    firstName: z.string().describe("First name"),
    lastName: z.string().describe("Last name"),
    age: z.number().describe("Age"),
  });

  try {
    const result = await structured({
      prompt: "Generate a person with first name, last name, and age",
      schema: TwoStringsOneNumberSchema,
      temperature: 0.3,
    });
    console.log(`✅ Two strings + one number works:`, result.object);
  } catch (error) {
    console.log(`❌ Two strings + one number failed: ${error}`);
  }

  // Test: Three strings (no numbers)
  const ThreeStringsSchema = z.object({
    firstName: z.string().describe("First name"),
    lastName: z.string().describe("Last name"),
    occupation: z.string().describe("Job title"),
  });

  try {
    const result = await structured({
      prompt: "Generate a person with first name, last name, and job",
      schema: ThreeStringsSchema,
      temperature: 0.3,
    });
    console.log(`✅ Three strings works:`, result.object);
  } catch (error) {
    console.log(`❌ Three strings failed: ${error}`);
  }

  // Test: One string + two numbers
  const OneStringTwoNumbersSchema = z.object({
    name: z.string().describe("Name"),
    age: z.number().describe("Age"),
    height: z.number().describe("Height in cm"),
  });

  try {
    const result = await structured({
      prompt: "Generate a person with name, age, and height",
      schema: OneStringTwoNumbersSchema,
      temperature: 0.3,
    });
    console.log(`✅ One string + two numbers works:`, result.object);
  } catch (error) {
    console.log(`❌ One string + two numbers failed: ${error}`);
  }

  // Test: Four fields (to test upper limit)
  const FourFieldsSchema = z.object({
    name: z.string().describe("Name"),
    age: z.number().describe("Age"),
    city: z.string().describe("City"),
    country: z.string().describe("Country"),
  });

  try {
    const result = await structured({
      prompt: "Generate a person with name, age, city, and country",
      schema: FourFieldsSchema,
      temperature: 0.3,
    });
    console.log(`✅ Four fields works:`, result.object);
  } catch (error) {
    console.log(`❌ Four fields failed: ${error}`);
  }
}

debugStructured().catch(console.error);
