const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// We will inject a catch-all at the top of importQuestions
const originalStart = "window.importQuestions = async function importQuestions() {";
const replacementStart = `window.importQuestions = async function importQuestions() {
    try {`;

const originalEnd = `if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }
        }`;
const replacementEnd = `if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }
    } catch (criticalError) {
        alert("CRITICAL ERROR: " + criticalError.message + "\\n" + criticalError.stack);
        console.error(criticalError);
    }
}`;

content = content.replace(originalStart, replacementStart).replace(originalEnd, replacementEnd);
fs.writeFileSync('src/main.js', content);
console.log("Injected debug block");
