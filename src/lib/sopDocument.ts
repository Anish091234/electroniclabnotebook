const ALLOWED_TAGS = new Set(["H1", "H2", "H3", "P", "UL", "OL", "LI", "STRONG", "EM", "U", "BR"]);

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeSopHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  }
  return parsed.body.innerHTML.trim() || "<p>Start writing your SOP here.</p>";
}

export function textToSopHtml(text: string) {
  const lines = text.replace(/\u00a0/g, " ").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line, index) => index === 0 ? `<h1>${escapeHtml(line)}</h1>` : `<p>${escapeHtml(line)}</p>`).join("");
}

export function stepsToSopHtml(steps: string[]) {
  return steps.filter(Boolean).map((step) => `<p>${escapeHtml(step)}</p>`).join("") || "<p>Start writing your SOP here.</p>";
}

export function sopHtmlToSteps(html: string, title: string) {
  const parsed = new DOMParser().parseFromString(sanitizeSopHtml(html), "text/html");
  const lines = Array.from(parsed.body.querySelectorAll("h1, h2, h3, p, li"))
    .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);
  return lines.filter((line, index) => !(index === 0 && line === title.trim()));
}

export async function exportSopDocx(name: string, html: string) {
  const { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } = await import("docx");
  const parsed = new DOMParser().parseFromString(sanitizeSopHtml(html), "text/html");

  const runsFor = (node: Node, formatting: { bold?: boolean; italics?: boolean; underline?: {} } = {}): InstanceType<typeof TextRun>[] => {
    if (node.nodeType === Node.TEXT_NODE) return [new TextRun({ text: node.textContent ?? "", ...formatting })];
    if (!(node instanceof HTMLElement)) return [];
    const nextFormatting = {
      bold: formatting.bold || node.tagName === "STRONG",
      italics: formatting.italics || node.tagName === "EM",
      underline: formatting.underline || (node.tagName === "U" ? {} : undefined),
    };
    if (node.tagName === "BR") return [new TextRun({ break: 1, ...formatting })];
    return Array.from(node.childNodes).flatMap((child) => runsFor(child, nextFormatting));
  };

  const children: InstanceType<typeof Paragraph>[] = [];
  for (const node of Array.from(parsed.body.children)) {
    const tag = node.tagName;
    if (tag === "UL" || tag === "OL") {
      for (const item of Array.from(node.querySelectorAll(":scope > li"))) {
        children.push(new Paragraph({
          children: runsFor(item),
          ...(tag === "UL" ? { bullet: { level: 0 } } : { numbering: { reference: "sop-numbering", level: 0 } }),
        }));
      }
      continue;
    }
    const heading = tag === "H1" ? HeadingLevel.HEADING_1 : tag === "H2" ? HeadingLevel.HEADING_2 : tag === "H3" ? HeadingLevel.HEADING_3 : undefined;
    children.push(new Paragraph({ children: runsFor(node), ...(heading ? { heading } : {}) }));
  }

  const document = new Document({
    numbering: { config: [{ reference: "sop-numbering", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT }] }] },
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(document);
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "") || "sop"}.docx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
