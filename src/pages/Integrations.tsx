import { useState } from "react";
import "./Dashboard.css";
import "./CompetitivePages.css";
import { useLabData } from "../contexts/LabDataContext";

function downloadText(fileName: string, content: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function Integrations() {
  const { inventoryItems, protocolTemplates, integrationImports, recordIntegrationImport } = useLabData();
  const [uploadState, setUploadState] = useState("");

  const exportInventory = () => {
    const rows = [
      ["item", "category", "vendor", "catalogNumber", "lot", "location", "quantity", "unit", "expiration", "status"],
      ...inventoryItems.flatMap((item) =>
        item.lots.map((lot) => [item.name, item.category, item.vendor, item.catalogNumber, lot.lotNumber, lot.location, lot.quantity, lot.unit, lot.expirationDate, lot.status]),
      ),
    ];
    downloadText("labos-inventory.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
  };

  const exportProtocols = () => {
    const data = JSON.stringify(protocolTemplates, null, 2);
    downloadText("labos-protocols.json", data, "application/json");
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setUploadState("Reading import...");
    const text = await file.text();
    const rowCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
    const header = text.split(/\r?\n/)[0] ?? "";
    await recordIntegrationImport({
      source: "csv",
      fileName: file.name,
      rowCount,
      summary: `CSV import captured ${rowCount} rows. Header: ${header.slice(0, 120)}`,
    });
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
            <p>Record CSV or instrument-style exports now. Later this can parse plate readers, qPCR, microscopy, and file-watch folders.</p>
            <label className="toolbar-ai-btn file-upload-btn">
              {uploadState || "Upload CSV"}
              <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => handleImport(e.target.files?.[0])} />
            </label>
          </section>

          <section className="workbench-panel">
            <h2>Export Data</h2>
            <p>Browser-side export keeps the Spark plan simple while still giving labs portable data.</p>
            <div className="workbench-actions">
              <button className="btn-primary" onClick={exportInventory}>Export Inventory CSV</button>
              <button className="btn-secondary" onClick={exportProtocols}>Export Protocol JSON</button>
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
