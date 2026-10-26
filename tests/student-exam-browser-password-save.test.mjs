import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureExamAccessCodeInput } from '../src/exam-access-code-input.js';

function fakeInput() {
    const values = new Map();
    return {
        type: 'password',
        style: {
            setProperty: (name, value) => values.set(name, value),
            removeProperty: name => values.delete(name),
            getPropertyValue: name => values.get(name) || ''
        }
    };
}

test('masked text input avoids browser password-save heuristics where supported', () => {
    const input = fakeInput();
    assert.equal(configureExamAccessCodeInput(input, { supports: () => true }), true);
    assert.equal(input.type, 'text');
    assert.equal(input.style.getPropertyValue('-webkit-text-security'), 'disc');
});
test('unsupported masking never exposes an access code as plaintext', () => {
    const input = fakeInput();
    assert.equal(configureExamAccessCodeInput(input, { supports: () => false }), false);
    assert.equal(input.type, 'password');
    assert.equal(input.style.getPropertyValue('-webkit-text-security'), '');
});
test('exam challenge retains server verification and hides code from password managers', () => {
    const main = readFileSync('src/main.js', 'utf8');
    assert.match(main, /configureExamAccessCodeInput\(input\)/);
    assert.match(main, /id="exam-password-input" type="password" name="exam-access-challenge" autocomplete="one-time-code"/);
    assert.match(main, /data-lpignore="true" data-1p-ignore="true"/);
    assert.match(main, /'X-Exam-Access-Code':code/);
    assert.match(main, /if\(!response\.ok\|\|!result\.data\)/);
    assert.match(main, /confirm\.disabled=busy\|\|!input\.value\.trim\(\)/);
});
