import * as XLSX from "xlsx";

/**
 * Reads an Excel or CSV file and returns the workbook
 */
export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        resolve(workbook);
      } catch (error) {
        reject(new Error("Failed to read Excel file: " + error.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Finds the row and column indices for dimension labels
 */
function findDimensionRows(worksheet) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  const dimensionRows = {
    boxName: null,
    weight: null,
    length: null,
    width: null,
    height: null,
  };

  // Search through all cells
  for (let row = 0; row <= range.e.r; row++) {
    for (let col = 0; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      if (!cell || !cell.v) continue;

      const cellValue = String(cell.v).toLowerCase().trim();

      // Check for box name (handles both "box name" and "name of box")
      if (cellValue.includes("box name") || cellValue.includes("name of box")) {
        dimensionRows.boxName = row;
      } else if (cellValue.includes("box weight")) {
        dimensionRows.weight = row;
      } else if (cellValue.includes("box length")) {
        dimensionRows.length = row;
      } else if (cellValue.includes("box width")) {
        dimensionRows.width = row;
      } else if (cellValue.includes("box height")) {
        dimensionRows.height = row;
      }
    }
  }

  return dimensionRows;
}

/**
 * Gets box names from the Excel sheet
 */
function getBoxNames(worksheet, boxNameRow) {
  if (boxNameRow === null) return [];

  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  const boxNames = [];

  // Start from column K (index 10) and read rightwards
  // Box names are typically in columns L-Q (indices 11-16)
  // Look for the first column that has a box name (skip "To be assigned" headers)
  let foundFirstBox = false;
  for (let col = 10; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: boxNameRow, c: col });
    const cell = worksheet[cellAddress];
    if (cell && cell.v) {
      const value = String(cell.v).trim();
      const lowerValue = value.toLowerCase();

      // Skip "To be assigned" headers
      if (lowerValue.includes("to be assigned")) {
        continue;
      }

      // If we find a valid box name (contains "B" and a number, or just looks like a box identifier)
      if (
        value &&
        (value.match(/[Bb]\d+/) || value.match(/P\d+\s*-\s*[Bb]\d+/))
      ) {
        foundFirstBox = true;
        boxNames.push({ name: value, colIndex: col });
      } else if (foundFirstBox) {
        // If we already found boxes and hit an empty/invalid cell, stop
        break;
      }
    } else if (foundFirstBox) {
      // If we already found boxes and hit an empty cell, stop
      break;
    }
  }

  return boxNames;
}

/**
 * Finds the header row and column indices for product data
 */
function findProductHeaders(worksheet) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  let headerRow = null;
  const columnIndices = {
    sku: null,
    asin: null,
    fnsku: null,
    quantity: null,
    boxColumns: [], // Array of {boxNum: number, colIndex: number}
  };

  // Find header row (look for "SKU" and "ASIN")
  for (let row = 0; row <= range.e.r && row < 20; row++) {
    let foundSku = false;
    let foundAsin = false;

    for (let col = 0; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      if (!cell || !cell.v) continue;

      const cellValue = String(cell.v).toLowerCase().trim();
      if (cellValue === "sku") {
        columnIndices.sku = col;
        foundSku = true;
      } else if (cellValue === "asin") {
        columnIndices.asin = col;
        foundAsin = true;
      } else if (cellValue === "fnsku") {
        columnIndices.fnsku = col;
      } else if (cellValue === "quantity") {
        columnIndices.quantity = col;
      } else if (
        cellValue.includes("box") &&
        (cellValue.includes("units") || cellValue.includes("quantity"))
      ) {
        // Extract box number from "Box 1 units", "Box 2 units", "Box 1 quantity", "Box 2 quantity", etc.
        const match = cellValue.match(/box\s*(\d+)/i);
        if (match) {
          const boxNum = parseInt(match[1], 10);
          columnIndices.boxColumns.push({ boxNum, colIndex: col });
        }
      }
    }

    if (foundSku && foundAsin) {
      headerRow = row;
      break;
    }
  }

  // Sort box columns by box number
  columnIndices.boxColumns.sort((a, b) => a.boxNum - b.boxNum);

  return { headerRow, columnIndices };
}

/**
 * Fills box units columns with product data
 */
function fillBoxUnits(worksheet, headerRow, columnIndices, productList) {
  if (headerRow === null) return;
  if (!productList || productList.length === 0) return;
  if (columnIndices.boxColumns.length === 0) return;

  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  let maxRow = range.e.r;
  let maxCol = range.e.c;

  // Process each data row
  for (let row = headerRow + 1; row <= range.e.r; row++) {
    // Get ASIN from this row
    const asinCell =
      columnIndices.asin !== null
        ? worksheet[XLSX.utils.encode_cell({ r: row, c: columnIndices.asin })]
        : null;

    if (!asinCell || !asinCell.v) continue;

    const asin = String(asinCell.v || "")
      .trim()
      .toUpperCase();

    if (!asin) continue;

    // Find matching product in OCR data by ASIN only
    const matchingProduct = productList.find((product) => {
      const productAsin = String(product.ASIN || "")
        .trim()
        .toUpperCase();

      if (!productAsin) return false;

      // Exact match on ASIN
      if (asin === productAsin) {
        return true;
      }

      // Partial match: check if one contains the other (handles trailing dashes/characters)
      const asinNormalized = asin.replace(/[^A-Z0-9]/g, "");
      const productAsinNormalized = productAsin.replace(/[^A-Z0-9]/g, "");
      if (
        asinNormalized &&
        productAsinNormalized &&
        asinNormalized.length > 0 &&
        productAsinNormalized.length > 0 &&
        (asinNormalized.includes(productAsinNormalized) ||
          productAsinNormalized.includes(asinNormalized))
      ) {
        return true;
      }

      return false;
    });

    if (!matchingProduct || !matchingProduct.Boxes) continue;

    // Fill box units columns
    columnIndices.boxColumns.forEach(({ boxNum, colIndex }) => {
      // Try both string and number keys for the box number
      const boxKeyString = String(boxNum);
      const boxKeyNumber = boxNum;

      const boxQuantity =
        matchingProduct.Boxes[boxKeyString] ||
        matchingProduct.Boxes[boxKeyNumber];

      if (boxQuantity !== undefined && boxQuantity !== null) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: colIndex });
        if (!worksheet[cellAddress]) {
          worksheet[cellAddress] = {};
        }
        worksheet[cellAddress].t = "n"; // number type
        worksheet[cellAddress].v = Number(boxQuantity);

        // Update max row and col for range
        if (row > maxRow) maxRow = row;
        if (colIndex > maxCol) maxCol = colIndex;
      }
    });
  }

  // Update worksheet range to include all filled cells
  worksheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow, c: maxCol },
  });
}

/**
 * Fills box dimensions in the Excel sheet
 */
function fillBoxDimensions(worksheet, dimensionRows, boxNames, boxDimensions) {
  if (!boxDimensions || boxDimensions.length === 0) return;
  if (dimensionRows.weight === null) return;

  // Sort box dimensions by box number
  const sortedDimensions = [...boxDimensions].sort((a, b) => {
    const aNum = parseInt(a["Box Number"] || a.BoxNumber || 0, 10);
    const bNum = parseInt(b["Box Number"] || b.BoxNumber || 0, 10);
    return aNum - bNum;
  });

  // Map OCR box numbers to Excel box names by order
  sortedDimensions.forEach((dimension, index) => {
    if (index >= boxNames.length) return; // Skip if more OCR boxes than Excel boxes

    const colIndex = boxNames[index].colIndex;

    // Fill weight
    if (dimensionRows.weight !== null && dimension.Weight) {
      const cellAddress = XLSX.utils.encode_cell({
        r: dimensionRows.weight,
        c: colIndex,
      });
      if (!worksheet[cellAddress]) {
        worksheet[cellAddress] = { t: "n" };
      }
      worksheet[cellAddress].v = parseFloat(dimension.Weight) || 0;
    }

    // Fill length
    if (dimensionRows.length !== null && dimension.Length) {
      const cellAddress = XLSX.utils.encode_cell({
        r: dimensionRows.length,
        c: colIndex,
      });
      if (!worksheet[cellAddress]) {
        worksheet[cellAddress] = { t: "n" };
      }
      worksheet[cellAddress].v = parseFloat(dimension.Length) || 0;
    }

    // Fill width
    if (dimensionRows.width !== null && dimension.Width) {
      const cellAddress = XLSX.utils.encode_cell({
        r: dimensionRows.width,
        c: colIndex,
      });
      if (!worksheet[cellAddress]) {
        worksheet[cellAddress] = { t: "n" };
      }
      worksheet[cellAddress].v = parseFloat(dimension.Width) || 0;
    }

    // Fill height
    if (dimensionRows.height !== null && dimension.Height) {
      const cellAddress = XLSX.utils.encode_cell({
        r: dimensionRows.height,
        c: colIndex,
      });
      if (!worksheet[cellAddress]) {
        worksheet[cellAddress] = { t: "n" };
      }
      worksheet[cellAddress].v = parseFloat(dimension.Height) || 0;
    }
  });
}

/**
 * Main function to process and fill Excel file with OCR data
 */
export function fillExcelWithData(workbook, productList, boxDimensions) {
  // Get the first worksheet
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Find product headers and fill box units
  const { headerRow, columnIndices } = findProductHeaders(worksheet);
  if (headerRow !== null) {
    fillBoxUnits(worksheet, headerRow, columnIndices, productList);
  }

  // Find dimension rows and fill box dimensions
  const dimensionRows = findDimensionRows(worksheet);
  if (dimensionRows.boxName !== null) {
    const boxNames = getBoxNames(worksheet, dimensionRows.boxName);
    fillBoxDimensions(worksheet, dimensionRows, boxNames, boxDimensions);
  }

  return workbook;
}

/**
 * Downloads the workbook as an Excel file
 */
export function downloadExcel(workbook, filename = "filled_workflow.xlsx") {
  // Write workbook to binary string
  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  // Create blob and download
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
