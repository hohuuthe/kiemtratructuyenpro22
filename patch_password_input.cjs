const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// The most robust way to prevent the browser from saving the exam password and associating it with the 'Họ và tên' field
// is to make the exam password input type="text" but stylize it as a password, or simply use autocomplete="new-password" on the actual password, and "off" on others.
// But Safari and Chrome are very aggressive. 
// A good trick is to use `<input type="text" class="text-security-disc">` (CSS `-webkit-text-security: disc;`)

content = content.replace(/<input type="password" id="exam-password-input"/g, '<input type="text" id="exam-password-input" style="-webkit-text-security: disc;"');
// And fix the togglePasswordVisibility logic
content = content.replace(/input.type === 'password'/g, "input.type === 'password' || input.style.webkitTextSecurity === 'disc'");
content = content.replace(/input.type = 'text';/g, "input.type = 'text'; input.style.webkitTextSecurity = 'none';");
content = content.replace(/input.type = 'password';/g, "input.type = 'text'; input.style.webkitTextSecurity = 'disc';"); // Fallback for browsers that don't support it

fs.writeFileSync('src/main.js', content);
console.log("Patched password input in main.js");
