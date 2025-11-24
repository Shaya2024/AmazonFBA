// server.js
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

// Get the directory of the current module (server folder)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the server directory
dotenv.config({ path: resolve(__dirname, ".env") });

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" })); // for base64 image

const ai = new GoogleGenAI({});

app.post("/api/vision/ocr", async (req, res) => {
  try {
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

    // Build contents array with images and text prompt for Google GenAI
    const systemPrompt = `You will receive ${imagesBase64.length} image(s) containing tables of rows of products with their ASIN, FNSKU and QTY. (there might be more columns, you can ignore them). Next to each row, there is a handwritten note indicating which box the item will be packed in and how many units are going into that box. For example, if the QTY is 18, it might say next to it "Box 2" which would indicate all 18 units will be packed in box 2. If it is written "Box 2 x4", it would indicate 4 units will be packed in box 2. Or it might say Box 2,4 9 each, which would indicate the 18 units will all be in boxes 2 and 4, with 9 units in each box. These are just examples, there might be other variations - use your best judgment.

Your task is to extract a structured list of products from ALL images with their:
- ASIN (e.g., B07ECS26RL)
- The handwritten note next to the item
- Total Item QTY
- An object with the box number and the quantity (if the item is packed in multiple boxes, the quantity will be split between the boxes).

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

    // Build contents array: images first, then text prompt
    const contents = [
      // Add all images
      ...imagesBase64.map((imageBase64) => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      })),
      // Add the text prompt
      { text: systemPrompt },
    ];

    const response = await ai.models.generateContent({
      model: "models/gemini-3-pro-preview",
      contents: contents,
    });

    const fullText = response.text || "";
    console.log(fullText);
    res.json({ fullText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
