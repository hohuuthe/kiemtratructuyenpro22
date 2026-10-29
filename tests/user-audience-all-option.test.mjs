import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../public/components/tab-users.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../functions/api/users.ts', import.meta.url), 'utf8');

const start = source.indexOf('function populateUsersFilters() {');
const end = source.indexOf('window.populateUsersFilters = populateUsersFilters;', start);
assert.ok(start !== -1 && end > start, 'User management audience refresh function must exist');
const populateSource = source.slice(start, end);

class SelectStub {
    constructor() {
        this.options = [{ value: '', textContent: '-- Tất cả đối tượng --', selected: true }];
        this.disabled = false;
        this.title = '';
        this.classList = { add() {}, remove() {} };
    }
    get value() {
        return this.options.find(option => option.selected)?.value ?? this.options[0]?.value ?? '';
    }
    set value(next) {
        this.options.forEach(option => { option.selected = option.value === next; });
    }
    set innerHTML(html) {
        this.options = [...html.matchAll(/<option\s+value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)]
            .map(match => ({ value: match[1], textContent: match[3], selected: /\bselected\b/.test(match[2]) }));
        if (this.options.length && !this.options.some(option => option.selected)) {
            this.options[0].selected = true;
        }
    }
    appendChild(option) {
        if (option.selected) this.options.forEach(current => { current.selected = false; });
        this.options.push(option);
    }
}

function setupFilter(users, teacher = false) {
    const audience = new SelectStub();
    const unit = new SelectStub();
    const classroom = new SelectStub();
    const controls = { 'users-audience-filter': audience, 'users-unit-filter': unit, 'users-class-filter': classroom };
    const document = {
        getElementById(id) { return controls[id] || null; },
        createElement(tag) {
            assert.equal(tag, 'option');
            return { value: '', textContent: '', selected: false };
        }
    };
    const window = { usersList: users, taState: null };
    const factory = new Function(
        'document', 'window', 'accounts', 'usersList', 'isTeacherLoggedIn', 'isAdminLoggedIn',
        'currentUser', 'escapeHTML',
        populateSource + '\nreturn populateUsersFilters;'
    );
    const populate = factory(document, window, [], users, teacher, !teacher,
        teacher ? { id: 'teacher1', donvi: 'School 1' } : { id: 'admin1' }, String);
    return { audience, window, populate };
}

const users = [
    { id: 's1', target_audience: 'Học sinh', donvi: 'School 1', lop: '12A' },
    { id: 't1', target_audience: 'Giáo viên', donvi: 'School 2', lop: '12B' },
    { id: 'none', target_audience: '', donvi: 'School 3', lop: '12C' }
];

test('Profiles audience filter visibly includes a real unfiltered option', () => {
    const htmlSelect = markup.match(/<select\b[^>]*id="users-audience-filter"[\s\S]*?<\/select>/);
    assert.ok(htmlSelect, 'Profile management filter must exist');
    assert.match(htmlSelect[0], /<option value="">-- Tất cả đối tượng --<\/option>/);
    assert.match(htmlSelect[0], /onchange="window\.filterUsers\(\)"/);
    assert.match(source, /audSelect\.innerHTML = '<option value="">-- Tất cả đối tượng --<\/option>'/);
});

test('Admin sees All first and refresh preserves or safely resets the chosen audience', () => {
    const { audience, window, populate } = setupFilter(users);
    populate();
    assert.equal(audience.disabled, false);
    assert.deepEqual(audience.options.map(option => option.value).sort(),
        ['', 'Giáo viên', 'Học sinh'].sort());
    assert.equal(audience.options[0].value, '');
    assert.equal(audience.options[0].textContent, '-- Tất cả đối tượng --');
    assert.equal(audience.value, '');
    audience.value = 'Học sinh';
    populate();
    assert.equal(audience.value, 'Học sinh', 'Refreshing the same data must retain an active filter');
    window.usersList = [{ id: 't1', target_audience: 'Giáo viên' }];
    populate();
    assert.equal(audience.value, '', 'Removing a selected audience must restore All');
    assert.deepEqual(audience.options.map(option => option.value), ['', 'Giáo viên']);
});

test('All is present even when there are no records and must not hide profiles without audience', () => {
    const { audience, populate } = setupFilter([]);
    populate();
    assert.equal(audience.options.length, 1);
    assert.equal(audience.value, '');
    const adminAudienceMatches = (audienceFilter, userAudience) =>
        !audienceFilter || userAudience.toLowerCase() === audienceFilter.toLowerCase();
    assert.ok(users.every(user => adminAudienceMatches('', user.target_audience)));
    assert.ok(!adminAudienceMatches('Học sinh', 'Giáo viên'));
    assert.match(source, /if \(audienceFilter && userAudience\.toLowerCase\(\) !== audienceFilter\.toLowerCase\(\)\)/);
    assert.match(source, /const hasActiveFilter = Boolean\(searchTerm \|\| audienceFilter \|\| unitFilter \|\| classFilter\)/);
});

test('Teachers stay locked to school students, including when All is offered to admin', () => {
    const { audience, populate } = setupFilter(users, true);
    populate();
    assert.equal(audience.disabled, true);
    assert.deepEqual(audience.options.map(option => option.value), ['Học sinh']);
    assert.match(source, /if \(userAudience\.toLowerCase\(\) !== 'học sinh'\)/);
    assert.match(server, /LOWER\(users\.target_audience\) = 'học sinh'/);
    assert.match(source, /if \(isTeacherOnly\)[\s\S]*?audSelect\.disabled = true/);
});
