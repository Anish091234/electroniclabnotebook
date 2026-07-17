export interface ImportedProtocol {
  name: string;
  description: string;
  steps: string[];
  documentHtml: string;
}

import { sanitizeSopHtml, textToSopHtml } from "./sopDocument";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function linesFromText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map((line) => line.replace(/^(?:[•◦▪▫*-]|\d+[.)])\s+/, ""))
    .filter(Boolean);
}

function protocolFromText(text: string, documentHtml = textToSopHtml(text)): ImportedProtocol {
  const lines = linesFromText(text);
  if (lines.length < 2) {
    throw new Error("We could not find enough readable text to make a protocol. Try a text-based PDF or a .docx file.");
  }

  const [name, ...remaining] = lines;
  const noteIndex = remaining.findIndex((line) => /^note:?$/i.test(line));
  const note = noteIndex >= 0 ? remaining[noteIndex + 1] : remaining.find((line) => /^note:/i.test(line));
  const description = note ? note.replace(/^note:\s*/i, "") : "Imported from document. Review the steps before saving.";
  const steps = remaining.filter((line, index) => {
    if (/^note:?$/i.test(line)) return false;
    return !(noteIndex >= 0 && index === noteIndex + 1);
  });

  if (steps.length === 0) {
    throw new Error("We found a title but no usable protocol steps in this document.");
  }

  return { name, description, steps, documentHtml: sanitizeSopHtml(documentHtml) };
}

async function readDocx(file: File) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const [textResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer }),
    mammoth.convertToHtml({ arrayBuffer }, { styleMap: ["p[style-name='List Paragraph'] => ul > li:fresh"] }),
  ]);
  return { text: textResult.value, html: htmlResult.value };
}

async function readPdf(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    let lineY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y: number | null = "transform" in item ? Number(item.transform[5]) : lineY;
      if (line && lineY !== null && y !== null && Math.abs(y - lineY) > 2) {
        lines.push(line);
        line = "";
      }
      lineY = y;
      line = `${line}${line ? " " : ""}${item.str}`;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
        lineY = null;
      }
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n"));
  }
  document.cleanup();
  return pages.join("\n");
}

export async function importProtocolFile(file: File): Promise<ImportedProtocol> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("Choose a file smaller than 20 MB.");
  }

  const fileName = file.name.toLowerCase();
  let text: string;
  let documentHtml: string | undefined;
  if (fileName.endsWith(".docx")) {
    const docx = await readDocx(file);
    text = docx.text;
    documentHtml = docx.html;
  } else if (fileName.endsWith(".pdf")) {
    text = await readPdf(file);
  } else {
    throw new Error("Choose a Word (.docx) or PDF file.");
  }

  return protocolFromText(text, documentHtml);
}
