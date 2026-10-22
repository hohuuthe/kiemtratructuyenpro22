const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// There are other login fields that legitimately use type="password" (e.g. admin login)
// If they don't have style.webkitTextSecurity initialized, toggle logic might be slightly weird, but `type = 'text'; webkitTextSecurity = 'disc'` will convert standard password fields into text + disc.
// Let's refine the toggle function to handle standard password fields cleanly.

const oldFunc = `            function togglePasswordVisibility(inputId, btn) {
            const input = document.getElementById(inputId);
            if (input.type === 'password' || input.style.webkitTextSecurity === 'disc') {
                input.type = 'text'; input.style.webkitTextSecurity = 'none';
                btn.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>';
            } else {
                input.type = 'text'; input.style.webkitTextSecurity = 'disc';
                btn.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>';
            }
        }`;

const newFunc = `        window.togglePasswordVisibility = function togglePasswordVisibility(inputId, btn) {
            const input = document.getElementById(inputId);
            const isCustomPassword = input.hasAttribute('style') && input.getAttribute('style').includes('-webkit-text-security');
            const isHidden = input.type === 'password' || (isCustomPassword && input.style.webkitTextSecurity === 'disc');
            
            if (isHidden) {
                if (isCustomPassword) {
                    input.style.webkitTextSecurity = 'none';
                } else {
                    input.type = 'text';
                }
                btn.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>';
            } else {
                if (isCustomPassword) {
                    input.style.webkitTextSecurity = 'disc';
                } else {
                    input.type = 'password';
                }
                btn.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>';
            }
        }`;

content = content.replace(oldFunc, newFunc);
fs.writeFileSync('src/main.js', content);
console.log("Fixed toggle logic.");
