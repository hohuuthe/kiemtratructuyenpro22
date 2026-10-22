const tests = [
  "A. Đáp án A",
  " B. Đáp án B",
  "C. Đáp án C   D. Đáp án D",
  "[[U]]A. Đáp án A[[/U]]",
  "[[U]]A.[[/U]] Đáp án A",
  "Chất nào là Vitamin A. Retinol",
  "A. 1    B. 2    C. 3    D. 4",
  " A) Đáp án A",
  " B: Đáp án B"
];

const optRegex = /(?:^\s*|\t|\s{2,}|\[\[U\]\])([A-D])[\.\)\:](?=\s|\[\[U\]\]|$)/gi;

tests.forEach(t => {
  console.log("Testing:", t);
  let matches = [...t.matchAll(optRegex)];
  matches.forEach(m => console.log("  Match:", m[1], "Index:", m.index, "Full:", m[0]));
});
