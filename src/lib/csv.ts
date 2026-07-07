export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  issues: string[];
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const issues: string[] = [];

  if (headers.length === 0) issues.push("No header row detected.");
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) issues.push("Duplicate column names detected.");

  dataRows.forEach((dataRow, index) => {
    if (dataRow.length !== headers.length) {
      issues.push(`Row ${index + 2} has ${dataRow.length} cells but the header has ${headers.length}.`);
    }
  });

  return { headers, rows: dataRows, issues };
}

export function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function valueFor(row: string[], headers: string[], candidates: string[]) {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  const index = candidates
    .map((candidate) => normalizedHeaders.indexOf(candidate.toLowerCase()))
    .find((candidateIndex) => candidateIndex >= 0);
  return index === undefined ? "" : row[index] ?? "";
}
