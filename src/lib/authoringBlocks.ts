import type { AuthoringBlock, AuthoringBlockKind } from "../data/types";

export interface AuthoringTemplate {
  label: string;
  kind: AuthoringBlockKind;
  title: string;
  content: string;
  required?: boolean;
}

export const AUTHORING_TEMPLATES: AuthoringTemplate[] = [
  {
    label: "PCR Setup",
    kind: "table",
    title: "PCR setup table",
    content: "Sample,Primer F,Primer R,Template ng,Anneal C,Ct\nSample A,,,,,\nSample B,,,,,",
    required: true,
  },
  {
    label: "Plate Reader",
    kind: "table",
    title: "Plate reader data",
    content: "Well,Sample,OD450,Notes\nA1,,,\nA2,,,\nB1,,,",
    required: true,
  },
  {
    label: "Sample Metadata",
    kind: "data",
    title: "Sample metadata",
    content: "Sample ID:\nSource:\nPassage:\nOperator:\nInstrument:\nRun ID:",
    required: true,
  },
  {
    label: "Run Checklist",
    kind: "checklist",
    title: "Pre-sign checklist",
    content: "[ ] Objective is complete\n[ ] Reagent lots are linked\n[ ] Raw data files are attached\n[ ] Deviations are explained",
    required: true,
  },
  {
    label: "Equation",
    kind: "equation",
    title: "Calculation",
    content: "C1V1 = C2V2",
  },
];

export function parseDelimitedRows(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes("|") ? "|" : ",";
  return lines.map((line) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim())
      .filter((cell, index, row) => cell || index < row.length - 1),
  );
}

export function parseChecklist(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      checked: /^\[[xX]\]/.test(line) || /^[-*]\s*\[[xX]\]/.test(line),
      label: line.replace(/^[-*]\s*/, "").replace(/^\[[ xX]\]\s*/, ""),
    }));
}

export function parseKeyValueRows(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.search(/[:=]/);
      if (separatorIndex < 0) return { key: line, value: "" };
      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    });
}

export function blockSearchText(block: AuthoringBlock) {
  return [block.kind, block.title, block.content, block.fileName ?? "", block.imageUrl ?? ""].join(" ");
}
