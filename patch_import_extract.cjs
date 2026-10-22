const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldStr = `                                if (child.nodeType === Node.TEXT_NODE) {
                                    result += child.textContent;
                                } else if (child.nodeType === Node.ELEMENT_NODE) {
                                    const tagName = child.tagName.toLowerCase();
                                    if (tagName === 'sup' || tagName === 'sub') {
                                        result += \`<\${tagName}>\${extractTextWithSupSub(child)}</\${tagName}>\`;
                                    } else if (tagName === 'br') {
                                        result += '\\n';
                                    } else {
                                        result += extractTextWithSupSub(child);
                                    }
                                }`;

const newStr = `                                if (child.nodeType === Node.TEXT_NODE) {
                                    result += child.textContent;
                                } else if (child.nodeType === Node.ELEMENT_NODE) {
                                    const tagName = child.tagName.toLowerCase();
                                    if (tagName === 'sup' || tagName === 'sub') {
                                        result += \`<\${tagName}>\${extractTextWithSupSub(child)}</\${tagName}>\`;
                                    } else if (tagName === 'span' && child.classList.contains('red-text')) {
                                        result += \`<span class="red-text">\${extractTextWithSupSub(child)}</span>\`;
                                    } else if (tagName === 'br') {
                                        result += '\\n';
                                    } else {
                                        result += extractTextWithSupSub(child);
                                    }
                                }`;

if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    console.log("Patched extractTextWithSupSub");
} else {
    console.log("Could not find extractTextWithSupSub");
}

fs.writeFileSync('src/main.js', content);
