// server.js
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

// Get the directory of the current module (server folder)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from server directory
const envPath = resolve(__dirname, ".env");
const result = dotenv.config({ path: envPath });

// Debug: Log if .env file was loaded
if (result.error) {
  console.warn(`Warning: Could not load .env file from ${envPath}`);
  console.warn(`Error: ${result.error.message}`);
  // Try loading from root directory as fallback
  const rootEnvPath = resolve(__dirname, "..", ".env");
  dotenv.config({ path: rootEnvPath });
} else {
  console.log(`Loaded .env file from ${envPath}`);
}

// Prevent Google Cloud from trying to use default credentials
// Set to empty string to disable default credentials lookup
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "";
}

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" })); // for base64 image

// Serve static files from the React app build
const distPath = resolve(__dirname, "..", "dist");
app.use(express.static(distPath));

// Initialize Google GenAI with API key from environment
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("Warning: GEMINI_API_KEY not found in environment variables");
  console.warn(`Current working directory: ${process.cwd()}`);
  console.warn(`Looking for .env at: ${envPath}`);
  console.warn(
    "Available env vars:",
    Object.keys(process.env)
      .filter((k) => k.includes("GEMINI") || k.includes("GOOGLE"))
      .join(", ") || "none"
  );
}
// Only initialize if API key is available
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Function to resize image from base64
async function resizeImage(base64String, maxDimension = 2048) {
  try {
    // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
    const base64Data = base64String.includes(",")
      ? base64String.split(",")[1]
      : base64String;

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Resize image using sharp
    const resizedBuffer = await sharp(imageBuffer)
      .resize(maxDimension, maxDimension, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Convert back to base64
    return resizedBuffer.toString("base64");
  } catch (error) {
    console.error("Error resizing image:", error);
    // Return original if resize fails
    return base64String;
  }
}

app.post("/api/vision/ocr", async (req, res) => {
  try {
    // Ensure API key is available
    if (!apiKey || !ai) {
      return res.status(500).json({
        error:
          "API key not configured. Please set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.",
      });
    }

    const { imagesBase64 } = req.body;
    if (
      !imagesBase64 ||
      !Array.isArray(imagesBase64) ||
      imagesBase64.length === 0
    ) {
      return res.status(400).json({
        error:
          "imagesBase64 array is required and must contain at least one image",
      });
    }

    // Resize all images before processing
    console.log(`Resizing ${imagesBase64.length} image(s)...`);
    const resizedImages = await Promise.all(
      imagesBase64.map((img) => resizeImage(img))
    );

    // Build contents array with images and text prompt for Google GenAI
    const systemPrompt = `You will receive ${resizedImages.length} image(s) containing tables of rows of products with their ASIN, FNSKU and QTY. (there might be more columns, you can ignore them). Next to each row, there is a handwritten note indicating which box the item will be packed in and how many units are going into that box. For example, if the QTY is 18, it might say next to it "Box 2" which would indicate all 18 units will be packed in box 2. If it is written "Box 2 x4", it would indicate 4 units will be packed in box 2. Or it might say Box 2,4 9 each, which would indicate the 18 units will all be in boxes 2 and 4, with 9 units in each box. These are just examples, there might be other variations - use your best judgment.

Your task is to extract a structured list of products from ALL images with their:
- ASIN (e.g., B07ECS26RL)
- The handwritten note next to the item
- Total Item QTY
- An object with the box number and the quantity (if the item is packed in multiple boxes, the quantity will be split between the boxes).

Sometimes, the user may cross out the qty and write a new qty. In this case, use the new qty that was handwritten and ignore the printed qty that has been crossed out.

Sometimes, the user may  have crossed out the qty and not written a new qty. In this case, leave the qty at "".

In addition to the above, there will be notes on a page indicating the weight and dimensions of the boxes. Record this in another object called Box Dimensions. Combine all box dimensions from all images.

Return the result as a JSON object with 2 nested objects: ProductList and Box Dimensions. They should be in the following format:
{ 
ProductList: [
            {
                "ASIN": "B07ECS26RL",
                "QTY": 18,
                "Handwritten Note": "Box 2,4 9 each",
                "Boxes": {
                    "2": 9,
                    "4": 9
                }
            },
            {
                "ASIN": "B07EDE27SA",
                "QTY": 10,
                "Handwritten Note": "Box 1",
                "Boxes": {
                    "1": 10
                }
            },
            {
                "ASIN": "B07EDE27SB",
                "QTY": 30,
                "Handwritten Note": "Box 7 - 10, Box 8 - 20",
                "Boxes": {
                    "7": 10,
                    "8": 20
                }
            },
            ...
            ],
            "Box Dimensions": [
                {
                    "Box Number": 1,
                    "Weight": 10,
                    "Height": 10,
                    "Width": 10,
                    "Length": 10
                },
                {
                    "Box Number": 2,
                    "Weight": 20,
                    "Height": 20,
                    "Width": 20,
                    "Length": 20
                },
                {
                    "Box Number": 3,
                    "Weight": 30,
                    "Height": 30,
                    "Width": 30,
                    "Length": 30
                },
            ...
            ]
            }

It is SUPER IMPORTANT that you align each handwritten note with the correct row of the table. Double check to make sure you have done this correctly. Process all images and combine all products and box dimensions into a single unified result.

It is super important that you do not miss any rows! 

You must not mispell any ASINs!

Ignore unrelated text or markings. If an ASIN is present but the box or quantity is unclear, return null for those fields. Keep your result accurate and structured.`;

    // Build contents array: images first, then text promp
    const contents = [
      // Add all resized images
      ...resizedImages.map((imageBase64) => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      })),
      // Add the text prompt
      { text: systemPrompt },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: contents,
    });

    const fullText = response.text || "";
    console.log(fullText);
    res.json({ fullText });
  } catch (err) {
    console.error("Error processing images:", err);
    // Check if it's a credentials error
    if (err.message && err.message.includes("default credentials")) {
      return res.status(500).json({
        error:
          "Authentication error. Please ensure GOOGLE_API_KEY or GEMINI_API_KEY is set correctly in your environment variables.",
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// The "catchall" handler: for any request that doesn't
// match an API route, send back React's index.html file.
app.get("*", (req, res) => {
  res.sendFile(resolve(distPath, "index.html"));
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
