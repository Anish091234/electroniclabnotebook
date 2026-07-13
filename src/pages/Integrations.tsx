import { useState } from "react";
import { getBlob, ref } from "firebase/storage";
import "./Dashboard.css";
import "./CompetitivePages.css";
import { useLabData } from "../contexts/LabDataContext";
import type { InventoryLot } from "../data/types";
import { storage } from "../lib/firebase";
import { parseCsv, rowsToCsv, valueFor, type ParsedCsv } from "../lib/csv";
import { createZip } from "../lib/zip";

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadText(fileName: string, content: string, type = "text/csv") {
  downloadBlob(fileName, new Blob([content], { type }));
}

function inferImportType(headers: string[]) {
  const normalized = headers.map((header) => header.toLowerCase());
  if (normalized.some((header) => header.includes("lot")) && normalized.some((header) => header.includes("quantity"))) return "inventory" as const;
  if (normalized.some((header) => header.includes("well")) || normalized.some((header) => header.includes("ct")) || normalized.some((header) => header.includes("od"))) return "instrument" as const;
  if (normalized.some((header) => header.includes("experiment")) || normalized.some((header) => header.includes("sample"))) return "experiment-data" as const;
  return "unknown" as const;
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]+/g, "-").slice(0, 90) || "file";
}

export function Integrations() {
  const {
    experimentDetails,
    protocolTemplates,
    inventoryItems,
    sampleRecords,
    projectRecords,
    collaborationTasks,
    auditEvents,
    attachments,
    integrationImports,
    recordIntegrationImport,
    saveInventoryItem,
  } = useLabData();
  const [uploadState, setUploadState] = useState("");
  const [parsedImport, setParsedImport] = useState<{
    fileName: string;
    parsed: ParsedCsv;
    importType: "inventory" | "experiment-data" | "instrument" | "unknown";
  } | null>(null);

  const exportInventory = () => {
    const rows = [
      ["item", "category", "vendor", "catalogNumber", "lot", "location", "quantity", "unit", "expiration", "status"],
      ...inventoryItems.flatMap((item) =>
        item.lots.map((lot) => [item.name, item.category, item.vendor, item.catalogNumber, lot.lotNumber, lot.location, lot.quantity, lot.unit, lot.expirationDate, lot.status]),
      ),
    ];
    downloadText("labos-inventory.csv", rowsToCsv(rows));
  };

  const exportProtocols = () => {
    const data = JSON.stringify(protocolTemplates, null, 2);
    downloadText("labos-protocols.json", data, "application/json");
  };

  const exportLabZip = async () => {
    setUploadState("Building ZIP...");
    const inventoryRows = [
      ["item", "category", "vendor", "catalogNumber", "lot", "location", "quantity", "unit", "expiration", "status"],
      ...inventoryItems.flatMap((item) =>
        item.lots.map((lot) => [item.name, item.category, item.vendor, item.catalogNumber, lot.lotNumber, lot.location, lot.quantity, lot.unit, lot.expirationDate, lot.status]),
      ),
    ];
    const attachmentManifest: Record<string, unknown>[] = [];
    const attachmentEntries: { path: string; data: Blob }[] = [];

    for (const attachment of attachments) {
      const manifestEntry = {
        id: attachment.id,
        experimentId: attachment.experimentId,
        protocolStepId: attachment.protocolStepId ?? null,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        storagePath: attachment.storagePath,
        generation: attachment.generation,
        sha256: attachment.sha256,
        state: attachment.state,
        uploadedByUid: attachment.uploadedByUid ?? null,
        uploadedAt: attachment.uploadedAt,
      };
      try {
        if (!storage || attachment.state !== "finalized") throw new Error("Attachment is not available through authenticated storage.");
        const blob = await getBlob(ref(storage, attachment.storagePath));
        const path = `attachments/${attachment.experimentId}/${attachment.id}-${sanitizeFileName(attachment.fileName)}`;
        attachmentEntries.push({ path, data: blob });
        attachmentManifest.push({ ...manifestEntry, exportPath: path, exportStatus: "included" });
      } catch {
        attachmentManifest.push({ ...manifestEntry, exportStatus: "fetch_failed" });
      }
    }

    const zip = await createZip([
      { path: "manifest.json", data: JSON.stringify({ exportedAt: new Date().toISOString(), app: "LabOS", attachmentCount: attachments.length }, null, 2) },
      { path: "experiments.json", data: JSON.stringify(Object.values(experimentDetails), null, 2) },
      { path: "protocols.json", data: JSON.stringify(protocolTemplates, null, 2) },
      { path: "inventory.csv", data: rowsToCsv(inventoryRows) },
      { path: "registry.json", data: JSON.stringify(sampleRecords, null, 2) },
      { path: "projects.json", data: JSON.stringify(projectRecords, null, 2) },
      { path: "tasks.json", data: JSON.stringify(collaborationTasks, null, 2) },
      { path: "audit-events.json", data: JSON.stringify(auditEvents, null, 2) },
      { path: "attachments-manifest.json", data: JSON.stringify(attachmentManifest, null, 2) },
      ...attachmentEntries,
    ]);
    downloadBlob(`labos-export-${new Date().toISOString().slice(0, 10)}.zip`, zip);
    setUploadState("");
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setUploadState("Reading import...");
    const text = await file.text();
    const parsed = parseCsv(text);
    const importType = inferImportType(parsed.headers);
    const validationIssues = [
      ...parsed.issues,
      ...(parsed.rows.length === 0 ? ["No data rows found after the header."] : []),
      ...(importType === "inventory" && !parsed.headers.some((header) => /item|name/i.test(header)) ? ["Inventory import needs an item/name column."] : []),
    ];
    setParsedImport({ fileName: file.name, parsed, importType });
    await recordIntegrationImport({
      source: "csv",
      fileName: file.name,
      rowCount: parsed.rows.length,
      importType,
      columns: parsed.headers,
      previewRows: parsed.rows.slice(0, 5),
      mapping: {
        item: "item, name, item name",
        lot: "lot, lot number, batch",
        quantity: "quantity, qty, amount",
      },
      validationIssues,
      summary: `${importType} CSV parsed with ${parsed.headers.length} columns and ${parsed.rows.length} data rows.`,
    });
    setUploadState("");
  };

  const importInventoryRows = async () => {
    if (!parsedImport || parsedImport.importType !== "inventory") return;
    setUploadState("Importing inventory...");
    const { headers, rows } = parsedImport.parsed;
    const grouped = new Map<string, { name: string; category: string; vendor: string; catalogNumber: string; unit: string; lots: InventoryLot[] }>();

    rows.forEach((row, index) => {
      const name = valueFor(row, headers, ["item", "item name", "name", "reagent"]) || `Imported item ${index + 1}`;
      const category = valueFor(row, headers, ["category", "type"]) || "Imported";
      const vendor = valueFor(row, headers, ["vendor", "manufacturer", "supplier"]);
      const catalogNumber = valueFor(row, headers, ["catalog", "catalog number", "catalogNumber", "sku"]);
      const unit = valueFor(row, headers, ["unit", "units"]) || "unit";
      const key = `${name}|${catalogNumber}|${unit}`;
      const existing = grouped.get(key) ?? { name, category, vendor, catalogNumber, unit, lots: [] };
      const quantity = Number(valueFor(row, headers, ["quantity", "qty", "amount"])) || 0;
      existing.lots.push({
        id: `lot-${Date.now()}-${index}`,
        lotNumber: valueFor(row, headers, ["lot", "lot number", "batch"]) || `import-${index + 1}`,
        location: valueFor(row, headers, ["location", "freezer", "box", "shelf"]),
        quantity,
        unit,
        expirationDate: valueFor(row, headers, ["expiration", "expiration date", "expires", "expiry"]),
        status: quantity <= 0 ? "depleted" : "available",
        notes: valueFor(row, headers, ["notes", "note", "comment"]),
      });
      grouped.set(key, existing);
    });

    for (const item of grouped.values()) {
      await saveInventoryItem(item);
    }
    setUploadState("");
  };

  return (
    <>
      <div className="topbar">
        <h1>Integrations</h1>
      </div>
      <div className="workbench-content">
        <div className="workbench-grid compact">
          <section className="workbench-panel">
            <h2>Import Data</h2>
            <p>Parse CSV or instrument-style exports, preview columns, validate rows, and import inventory lots when the mapping is clear.</p>
            <label className="toolbar-ai-btn file-upload-btn">
              {uploadState || "Upload CSV"}
              <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => handleImport(e.target.files?.[0])} />
            </label>
            {parsedImport && (
              <div className="import-preview">
                <div className="workbench-card-row">
                  <div>
                    <h3>{parsedImport.fileName}</h3>
                    <p>{parsedImport.importType} import, {parsedImport.parsed.rows.length} rows</p>
                  </div>
                  <span className="workbench-pill primary">{parsedImport.parsed.headers.length} columns</span>
                </div>
                <div className="workbench-pill-row">
                  {parsedImport.parsed.headers.map((header) => <span key={header} className="workbench-pill">{header}</span>)}
                </div>
                {parsedImport.parsed.issues.length > 0 && parsedImport.parsed.issues.map((issue) => <p key={issue} className="import-issue">{issue}</p>)}
                <div className="import-table-wrap">
                  <table className="import-table">
                    <thead>
                      <tr>{parsedImport.parsed.headers.map((header) => <th key={header}>{header}</th>)}</tr>
                    </thead>
                    <tbody>
                      {parsedImport.parsed.rows.slice(0, 5).map((row, rowIndex) => (
                        <tr key={`preview-${rowIndex}`}>
                          {parsedImport.parsed.headers.map((_header, cellIndex) => <td key={`preview-${rowIndex}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsedImport.importType === "inventory" && <button className="btn-secondary" onClick={importInventoryRows}>Import Inventory Lots</button>}
              </div>
            )}
          </section>

          <section className="workbench-panel">
            <h2>Export Data</h2>
            <p>Browser-side export keeps the Spark plan simple while still giving labs portable records and attachments.</p>
            <div className="workbench-actions">
              <button className="btn-primary" onClick={exportInventory}>Export Inventory CSV</button>
              <button className="btn-secondary" onClick={exportProtocols}>Export Protocol JSON</button>
              <button className="btn-secondary" onClick={exportLabZip}>Export Lab ZIP</button>
            </div>
          </section>
        </div>

        <div className="workbench-list">
          {integrationImports.length === 0 && <div className="empty-row">No imports recorded yet.</div>}
          {integrationImports.map((item) => (
            <article key={item.id} className="workbench-card">
              <div className="workbench-card-row">
                <div>
                  <h2>{item.fileName}</h2>
                  <p>{item.summary}</p>
                </div>
                <span className="workbench-pill primary">{item.source}</span>
              </div>
              <div className="workbench-pill-row">
                <span className="workbench-pill">{item.rowCount} rows</span>
                <span className="workbench-pill">{item.importType ?? "unknown"}</span>
                {(item.validationIssues?.length ?? 0) > 0 && <span className="workbench-pill primary">{item.validationIssues?.length} issues</span>}
                <span className="workbench-pill">{item.createdBy}</span>
                <span className="workbench-pill">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
