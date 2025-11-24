import React, { useState, useEffect } from "react";
import { Button, Box, Card } from "@mui/material";
import { X } from "lucide-react";
import {
  readExcelFile,
  fillExcelWithData,
  downloadExcel,
} from "../utils/excelProcessor";

export default function ImageUploader() {
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [excelFile, setExcelFile] = useState(null);
  const [excelFileName, setExcelFileName] = useState("");
  const [parsedData, setParsedData] = useState({ data: [], boxNumbers: [] });
  const [boxDimensions, setBoxDimensions] = useState([]);
  const [fullText, setFullText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({
    current: 0,
    total: 0,
    message: "",
  });
  const [error, setError] = useState("");
  const [filledWorkbook, setFilledWorkbook] = useState(null);

  // Cleanup object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      previews.forEach((preview) => {
        if (preview) {
          URL.revokeObjectURL(preview);
        }
      });
    };
  }, [previews]);

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      // Cleanup previous preview URLs
      previews.forEach((preview) => {
        if (preview) {
          URL.revokeObjectURL(preview);
        }
      });

      const newPreviews = files.map((file) => URL.createObjectURL(file));
      setImages(files);
      setPreviews(newPreviews);
      setError("");
      setFullText("");
      setParsedData({ data: [], boxNumbers: [] });
      setBoxDimensions([]);
      setFilledWorkbook(null);
    }
  };

  const removeImage = (index) => {
    // Cleanup the preview URL for the removed image
    if (previews[index]) {
      URL.revokeObjectURL(previews[index]);
    }

    const newImages = images.filter((_, i) => i !== index);
    const newPreviews = previews.filter((_, i) => i !== index);
    setImages(newImages);
    setPreviews(newPreviews);
  };

  const handleExcelChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const validTypes = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
        "application/vnd.ms-excel", // .xls
        "text/csv", // .csv
      ];

      if (
        !validTypes.includes(file.type) &&
        !file.name.match(/\.(xlsx|xls|csv)$/i)
      ) {
        setError("Please upload a valid Excel (.xlsx, .xls) or CSV file");
        return;
      }

      setExcelFile(file);
      setExcelFileName(file.name);
      setError("");
      setFilledWorkbook(null);
    }
  };

  const handleSubmit = async () => {
    if (!images || images.length === 0) {
      setError("Please upload at least one image first");
      return;
    }

    if (!excelFile) {
      setError("Please upload an Excel/CSV file first");
      return;
    }

    setLoading(true);
    setError("");
    // Clear previous results when processing again
    setParsedData({ data: [], boxNumbers: [] });
    setBoxDimensions([]);
    setFullText("");
    setFilledWorkbook(null);
    setLoadingProgress({
      current: 0,
      total: images.length,
      message: "Converting images to base64...",
    });
    try {
      // Step 1: Convert all images to base64
      const imagesBase64 = [];
      for (let i = 0; i < images.length; i++) {
        setLoadingProgress({
          current: i + 1,
          total: images.length,
          message: `Converting image ${i + 1} of ${images.length}...`,
        });
        const base64 = await toBase64(images[i]);
        imagesBase64.push(base64);
      }

      // Step 2: Send all images to Gemini in a single request
      setLoadingProgress({
        current: images.length,
        total: images.length,
        message: `Sending ${images.length} image(s) to Gemini...`,
      });

      const res = await fetch("/api/vision/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagesBase64 }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(
          `Error processing images: ${
            errorData.error || `HTTP error! status: ${res.status}`
          }`
        );
      }

      setLoadingProgress({
        current: images.length,
        total: images.length,
        message: "Parsing response from Gemini...",
      });

      const data = await res.json();
      const text = data.fullText || "";
      setFullText(text);

      // Parse the combined response
      const parsed = parseText(text);
      const productList = parsed.data.data || [];
      const boxDimensions = parsed.boxDimensions || [];

      // Merge product lists in case there are duplicates (combine quantities for same ASIN/FNSKU)
      const mergedProducts = mergeProductLists(productList);

      // Extract unique box numbers from merged products
      const boxNumbers = new Set();
      mergedProducts.forEach((item) => {
        if (item.Boxes && typeof item.Boxes === "object") {
          Object.keys(item.Boxes).forEach((boxNum) =>
            boxNumbers.add(parseInt(boxNum, 10))
          );
        }
      });

      const finalParsedData = {
        data: mergedProducts,
        boxNumbers: Array.from(boxNumbers).sort((a, b) => a - b),
      };

      // Merge box dimensions (keep unique box numbers, prefer later values if duplicates)
      const mergedBoxDimensions = mergeBoxDimensions(boxDimensions);

      setParsedData(finalParsedData);
      setBoxDimensions(mergedBoxDimensions);

      // Step 3: Process Excel file and fill with data
      setLoadingProgress({
        current: images.length,
        total: images.length,
        message: "Reading Excel file...",
      });

      const workbook = await readExcelFile(excelFile);

      setLoadingProgress({
        current: images.length,
        total: images.length,
        message: "Filling Excel with data...",
      });

      const filledWorkbook = fillExcelWithData(
        workbook,
        mergedProducts,
        mergedBoxDimensions
      );
      setFilledWorkbook(filledWorkbook);

      setLoadingProgress({
        current: images.length,
        total: images.length,
        message: "Complete!",
      });
    } catch (err) {
      console.error("Error:", err);
      setError(err.message || "Failed to process images. Please try again.");
    } finally {
      setLoading(false);
      // Clear progress after a short delay
      setTimeout(() => {
        setLoadingProgress({ current: 0, total: 0, message: "" });
      }, 1000);
    }
  };

  // Helper function to merge product lists
  const mergeProductLists = (productLists) => {
    const productMap = new Map();

    productLists.forEach((product) => {
      const key = (product.ASIN || "").trim() || (product.FNSKU || "").trim();
      if (!key) return;

      if (productMap.has(key)) {
        const existing = productMap.get(key);
        // Merge Boxes objects
        if (product.Boxes && typeof product.Boxes === "object") {
          if (!existing.Boxes) {
            existing.Boxes = {};
          }
          Object.keys(product.Boxes).forEach((boxNum) => {
            existing.Boxes[boxNum] =
              (existing.Boxes[boxNum] || 0) + (product.Boxes[boxNum] || 0);
          });
        }
        // Update quantity
        existing.Quantity =
          (existing.Quantity || existing.QTY || 0) +
          (product.Quantity || product.QTY || 0);
        existing.QTY = existing.Quantity;
      } else {
        productMap.set(key, { ...product });
      }
    });

    return Array.from(productMap.values());
  };

  // Helper function to merge box dimensions
  const mergeBoxDimensions = (boxDimensionsList) => {
    const dimensionMap = new Map();

    boxDimensionsList.forEach((dimension) => {
      const boxNum = dimension["Box Number"] || dimension.BoxNumber;
      if (boxNum !== undefined && boxNum !== null) {
        // If box number already exists, prefer the later one (or you could merge/validate)
        dimensionMap.set(boxNum, dimension);
      }
    });

    return Array.from(dimensionMap.values()).sort((a, b) => {
      const aNum = parseInt(a["Box Number"] || a.BoxNumber || 0, 10);
      const bNum = parseInt(b["Box Number"] || b.BoxNumber || 0, 10);
      return aNum - bNum;
    });
  };

  const handleDownload = () => {
    if (!filledWorkbook) {
      setError(
        "No filled Excel file available. Please process the image first."
      );
      return;
    }

    // Generate filename from original Excel filename
    const baseName = excelFileName.replace(/\.[^/.]+$/, "") || "workflow";
    const downloadName = `${baseName}_filled.xlsx`;
    downloadExcel(filledWorkbook, downloadName);
  };

  const toBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(",")[1]); // remove data URI prefix
      reader.onerror = reject;
    });

  const parseText = (text) => {
    try {
      // Remove markdown code blocks if present
      let cleanedText = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const jsonData = JSON.parse(cleanedText);
      const productList = jsonData.ProductList || [];
      const boxDimensionsList = jsonData["Box Dimensions"] || [];

      // Extract and sort unique box numbers
      const boxNumbers = new Set();
      productList.forEach((item) => {
        if (item.Boxes && typeof item.Boxes === "object") {
          Object.keys(item.Boxes).forEach((boxNum) =>
            boxNumbers.add(parseInt(boxNum, 10))
          );
        }
      });

      return {
        data: {
          data: productList,
          boxNumbers: Array.from(boxNumbers).sort((a, b) => a - b),
        },
        boxDimensions: boxDimensionsList,
      };
    } catch (err) {
      console.error("Failed to parse JSON:", err);
      return { data: { data: [], boxNumbers: [] }, boxDimensions: [] };
    }
  };

  return (
    <div style={{ padding: "1rem" }}>
      {/* Excel/CSV Upload Section */}
      <Box
        sx={{
          marginTop: "2rem",
          marginBottom: "2rem",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Card elevation={3} sx={{ padding: "1.5rem", width: "50%" }}>
          <h3>Step 1: Upload Excel/CSV Template</h3>
          <label htmlFor="excel-upload">
            <input
              id="excel-upload"
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              onChange={handleExcelChange}
              style={{ display: "none" }}
            />
            <Button
              variant="outlined"
              component="span"
              style={{ marginRight: "1rem" }}
            >
              {excelFileName || "Choose Excel/CSV File"}
            </Button>
          </label>
          {excelFileName && (
            <span style={{ color: "green", marginLeft: "1rem" }}>
              ✓ {excelFileName}
            </span>
          )}
        </Card>
      </Box>

      {/* Image Upload Section */}
      <Box
        sx={{ marginBottom: "2rem", display: "flex", justifyContent: "center" }}
      >
        <Card elevation={3} sx={{ padding: "1.5rem", width: "50%" }}>
          <h3>Step 2: Upload Handwritten Box Notes Images</h3>
          <label htmlFor="file-upload">
            <input
              id="file-upload"
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageChange}
              style={{ display: "none" }}
            />
            <Button
              variant="outlined"
              component="span"
              style={{ marginRight: "1rem" }}
            >
              Choose Images (Multiple)
            </Button>
          </label>
          {images.length > 0 && (
            <span style={{ color: "green", marginLeft: "1rem" }}>
              ✓ {images.length} image{images.length !== 1 ? "s" : ""} selected
            </span>
          )}
          {previews.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h4>Previews:</h4>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "1rem",
                  marginTop: "0.5rem",
                  justifyContent: "center",
                }}
              >
                {previews.map((preview, index) => (
                  <div
                    key={index}
                    style={{
                      position: "relative",
                      display: "inline-block",
                      marginBottom: "1rem",
                    }}
                  >
                    <img
                      src={preview}
                      alt={`Preview ${index + 1}`}
                      style={{
                        maxWidth: "200px",
                        maxHeight: "200px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                      }}
                    />
                    <button
                      onClick={() => removeImage(index)}
                      style={{
                        position: "absolute",
                        top: "-10px",
                        right: "-10px",
                        background: "red",
                        color: "white",
                        border: "none",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                      }}
                      title="Remove image"
                    >
                      <X size={16} />
                    </button>
                    <div
                      style={{
                        textAlign: "center",
                        marginTop: "0.25rem",
                        fontSize: "0.875rem",
                        color: "#666",
                      }}
                    >
                      Image {index + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </Box>

      {/* Submit Button */}
      {images.length > 0 && excelFile && (
        <div style={{ marginBottom: "2rem" }}>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading}
            size="large"
          >
            {loading ? "Processing..." : "Process and Fill Excel"}
          </Button>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: "2rem",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "4px solid #e3f2fd",
              borderTop: "4px solid #1976d2",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
        </div>
      )}

      {/* Download Button */}
      {filledWorkbook && (
        <div style={{ marginBottom: "2rem" }}>
          <Button
            variant="contained"
            color="success"
            onClick={handleDownload}
            size="large"
          >
            Download Filled Excel
          </Button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: "1rem", color: "red" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {parsedData.data.length > 0 ? (
        <>
          <h3>Product List:</h3>
          <div style={{ overflowX: "auto", marginTop: "1rem" }}>
            <table
              border="1"
              cellPadding="6"
              style={{ borderCollapse: "collapse", width: "100%" }}
            >
              <thead>
                <tr>
                  <th>ASIN</th>
                  <th>FNSKU</th>
                  <th>Quantity</th>
                  {parsedData.boxNumbers.map((boxNum) => (
                    <th key={boxNum}>Box {boxNum} units</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedData.data.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.ASIN || ""}</td>
                    <td>{item.FNSKU || ""}</td>
                    <td>{item.Quantity || item.QTY || 0}</td>
                    {parsedData.boxNumbers.map((boxNum) => {
                      // Handle Boxes object format (multiple boxes per item)
                      if (
                        item.Boxes &&
                        typeof item.Boxes === "object" &&
                        item.Boxes[boxNum]
                      ) {
                        return <td key={boxNum}>{item.Boxes[boxNum]}</td>;
                      }
                      // No box match
                      return <td key={boxNum}></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {boxDimensions.length > 0 && (
            <>
              <h3 style={{ marginTop: "2rem" }}>Box Dimensions:</h3>
              <div style={{ overflowX: "auto", marginTop: "1rem" }}>
                <table
                  border="1"
                  cellPadding="6"
                  style={{ borderCollapse: "collapse", width: "100%" }}
                >
                  <thead>
                    <tr>
                      <th>Box Number</th>
                      <th>Weight (lb)</th>
                      <th>Length (inch)</th>
                      <th>Width (inch)</th>
                      <th>Height (inch)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boxDimensions.map((box, idx) => (
                      <tr key={idx}>
                        <td>{box["Box Number"] || box.BoxNumber || ""}</td>
                        <td>{box.Weight || ""}</td>
                        <td>{box.Length || ""}</td>
                        <td>{box.Width || ""}</td>
                        <td>{box.Height || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : fullText ? (
        <div style={{ marginTop: "1rem", color: "orange" }}>
          <strong>Note:</strong> Could not parse JSON from the response. Check
          the console for details.
        </div>
      ) : null}
    </div>
  );
}
