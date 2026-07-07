import type { TemplateLibraryItem } from "./types";

export const TEMPLATE_LIBRARY: TemplateLibraryItem[] = [
  {
    id: "tpl-pcr",
    category: "Molecular Biology",
    name: "PCR Setup and Validation",
    description: "Template for primer setup, thermocycler program, gel validation, and result interpretation.",
    tags: ["PCR", "validation", "DNA"],
    steps: [
      "Record primer IDs, template DNA source, polymerase lot, and master mix lot.",
      "Prepare reaction table with volumes, controls, and replicate count.",
      "Run thermocycler program and attach instrument export.",
      "Document gel image, expected band size, and interpretation.",
    ],
  },
  {
    id: "tpl-elisa",
    category: "Immunoassay",
    name: "ELISA Plate Run",
    description: "Capture plate map, standards, sample dilutions, raw absorbance, and curve quality.",
    tags: ["ELISA", "plate", "assay"],
    steps: [
      "Record kit, antibody, standard, substrate, and plate lots.",
      "Define plate map and sample dilution scheme.",
      "Run assay timing checkpoints and reader export.",
      "Review standard curve, blanks, CVs, and outliers.",
    ],
  },
  {
    id: "tpl-western",
    category: "Protein",
    name: "Western Blot",
    description: "Track gel, transfer, blocking, antibody incubations, imaging, and quantification.",
    tags: ["western blot", "protein", "imaging"],
    steps: [
      "Record sample prep, gel type, buffer lots, and loading plan.",
      "Document transfer conditions and membrane handling.",
      "Record primary and secondary antibody lots and dilutions.",
      "Attach image files and quantify bands with normalization notes.",
    ],
  },
  {
    id: "tpl-cell-culture",
    category: "Cell Biology",
    name: "Cell Culture Passage",
    description: "Routine passage record with media, passage number, confluency, and contamination check.",
    tags: ["cell culture", "passage", "QC"],
    steps: [
      "Record cell line registry ID, passage number, media, serum, and supplement lots.",
      "Document confluency, morphology, viability, and contamination check.",
      "Record split ratio, seeding density, vessel type, and incubator location.",
      "Update sample registry lineage for new aliquots or flasks.",
    ],
  },
  {
    id: "tpl-microscopy",
    category: "Imaging",
    name: "Microscopy Acquisition",
    description: "Structured capture of microscope settings, channels, sample prep, and image files.",
    tags: ["microscopy", "imaging", "instrument"],
    steps: [
      "Record sample registry ID, stain lots, mountant, and slide/coverslip details.",
      "Capture microscope, objective, channels, exposure, gain, and z-stack settings.",
      "Attach raw image files or acquisition export.",
      "Document image QC, processing settings, and representative fields.",
    ],
  },
  {
    id: "tpl-analytical",
    category: "Analytical Chemistry",
    name: "LC/MS Analytical Run",
    description: "Instrument run record for standards, samples, method, chromatograms, and batch QC.",
    tags: ["LC/MS", "chemistry", "instrument"],
    steps: [
      "Record instrument, column, method version, solvent lots, and calibration state.",
      "Define standard curve, blanks, QC samples, and injection sequence.",
      "Attach instrument export and chromatograms.",
      "Review retention time, peak integration, carryover, and QC acceptance.",
    ],
  },
];
