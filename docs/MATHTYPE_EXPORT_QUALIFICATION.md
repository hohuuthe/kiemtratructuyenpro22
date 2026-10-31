# MathType export - isolated qualification stage

Status: ENABLED IN PRODUCTION BY PROJECT OWNER REQUEST; native-editor acceptance remains tracked separately.

The approved design explicitly requires real Word desktop + MathType open/edit/save
qualification before wiring the choice into the existing export dialogs. No test in
this branch substitutes an image for an editable object or claims that a passing
JavaScript test proves that native MathType can edit it.

## Protected existing behavior

No edits to `src/main.js`, `src/exam-docx-generator.ts`,
`src/question-bank-docx-generator.ts`, Word import modules, exam-selection APIs,
Excel export, root package dependencies, database schemas or existing workflows.
`finalizeWordExport(blob)` and `{equationFormat:'equation'}` return the identical
input object. The MathType path cannot be enabled by a caller-supplied `force` flag.
The UI control is mounted in both Word export dialogs. Equation remains selected by default. MathType is enabled on Production and Preview only when the user explicitly selects it.

## Implemented

* Namespace-aware bounded OMML -> immutable structural AST.
* Independent MTEF v5 encoder, CFB v3 regular FAT/MiniFAT writer, native Equation
  stream and four known DATA-ONLY streams. No uploaded OLE executable is copied.
* All-or-nothing DOCX postprocessor: equations in document/header/footer/notes,
  unique IDs, relationships, media, content types, per-object SHA-256 receipt.
* Shared AST for native bytes and MathML preview. MathJax emits glyph-path SVG;
  browser PNG rasterizer and isolated Sharp qualification renderer are separate.
* Cancellation, output-size limits, unsupported-semantics errors, unchanged
  non-math text assertions. No network requests to third-party conversion services.
* Equation/MathType radio controls are attached to both Production Word export dialogs; Equation remains the default.

## Explicit current limits

Not every OMML construct is covered. Unqualified alphabets, mixed column
alignments, noBar fractions, crossed boxes, colored math, mixed sizes and unknown
properties fail closed rather than being guessed or flattened into images.
The source of truth is current OMML, not an old OLE object or cached source PNG.
Real native editing and full app UI/phone acceptance remain UNVERIFIED.
The fixture qualification uses synthetic math examples, not the user's live DB.

## Run tests

```sh
npm install
npm install --prefix qualification/mathtype-export
node --test tests/word-mathtype-export.test.mjs
node --import tsx --test tests/word-mathtype-export-app.test.mjs
npm run test:word-import-release
npm run lint
npm run build
```

45 local tests cover binary/package safety and real MathJax SVG rendering.
Packaging tests clearly label the injected one-pixel PNG as a STUB; those tests
alone do not establish visual fidelity. The separately generated sample uses
real MathJax + Sharp rendering and was rendered for visual inspection.
The app integration suite uses the actual unchanged generators and the existing
121-equation corpus; its execution status must be reported separately from the
local standalone suite when the installed app libraries are unavailable locally.

## Native acceptance required before enablement

On the agreed supported Word desktop + MathType versions:
1. Open the qualification DOCX with no repair prompt; inspect every formula.
2. Double-click each structure and confirm MathType opens an editable equation.
3. Change a numerator/index/limit/matrix cell, save, close Word, reopen and check
   both the displayed preview and the content opened in MathType.
4. Check repeated formulas edit independently; no unrelated object changes.
5. Compare both export modes on the same finalized question IDs and answer keys.
6. Verify the full required corpus, then record versions, evidence and exceptions.
7. Production wiring is enabled by explicit project-owner request. Continue phone, multi-code-exam,
   answer, download and end-to-end native Word/MathType checks as post-release qualification.
8. Do not interpret Production enablement or a green build as proof of native Word/MathType editability.

## Technical references

WIRIS MathType SDK MTEF v5 records/template slot order:
https://docs.wiris.com/mathtype-sdk-documentation/mathtype-mtef-v5-mathtype-40-and-later
WIRIS Equation Native / OLE storage:
https://docs.wiris.com/en_US/mathtype-sdk/how-mtef-is-stored-in-files-and-objects
Microsoft MS-CFB and MS-OLEDS CompObjStream specifications.
