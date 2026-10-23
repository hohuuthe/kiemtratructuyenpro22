import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { neon, neonConfig } from '@neondatabase/serverless';
import { persistVerifiedWordImport } from '../functions/api/questions/import-word.ts';

// This runs the real PostgreSQL SQL engine and the actual Neon HTTP client.
// Only the HTTP transport is replaced, so no cloud database or network is used.
// It does not substitute for acceptance against a separately provisioned Neon staging DB.
async function isolatedDatabase() {
    const db = new PGlite();
    const schema = await readFile(new URL('../database-schema.sql', import.meta.url), 'utf8');
    const questionsSchema = schema.match(/CREATE TABLE IF NOT EXISTS questions\s*\([\s\S]*?\);/);
    assert.ok(questionsSchema, 'The application questions schema must be available');
    await db.exec(questionsSchema[0]);
    const requests = [];
    const previousFetch = neonConfig.fetchFunction;
    const previousEndpoint = neonConfig.fetchEndpoint;
    const endpoint = 'https://word-import-postgres.invalid/sql';
    neonConfig.fetchEndpoint = endpoint;
    neonConfig.fetchFunction = async (url, options) => {
        assert.equal(url, endpoint, 'No request may leave the isolated SQL transport');
        const payload = JSON.parse(options.body);
        const headers = new Headers(options.headers);
        requests.push({ payload, isolation: headers.get('Neon-Batch-Isolation-Level') });
        const execute = async (connection, item) => {
            const result = await connection.query(item.query, item.params);
            return {
                fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
                rows: result.rows.map(row => result.fields.map(field => {
                    const value = row[field.name];
                    return value === null || value === undefined ? null
                        : typeof value === 'object' ? JSON.stringify(value) : String(value);
                })),
                rowCount: result.affectedRows ?? result.rows.length,
                command: item.query.trim().split(/\s+/)[0].toUpperCase()
            };
        };
        try {
            const result = Array.isArray(payload.queries)
                ? { results: await db.transaction(async transaction => {
                    const isolation = headers.get('Neon-Batch-Isolation-Level');
                    // Missing header means the database default, just as on the real HTTP service.
                    // The success test below separately requires the caller to request Serializable.
                    if (isolation === 'Serializable') await transaction.exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
                    else assert.equal(isolation, null, 'Unexpected test transaction isolation header');
                    const results = [];
                    for (const query of payload.queries) results.push(await execute(transaction, query));
                    return results;
                }) }
                : await execute(db, payload);
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
            return new Response(JSON.stringify({
                message: error.message, code: error.code, detail: error.detail,
                schema: error.schema, table: error.table, constraint: error.constraint
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    };
    const sql = neon('postgresql://offline:offline@word-import-postgres.invalid/acceptance');
    return {
        db, sql, requests,
        async close() {
            neonConfig.fetchFunction = previousFetch;
            neonConfig.fetchEndpoint = previousEndpoint;
            await db.close();
        }
    };
}

const sourceOmml = '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
    '<m:f><m:num><m:r><m:t>x+1</m:t></m:r></m:num>' +
    '<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>';
const latex = '\\frac{x+1}{2}';
function question(id, tokenNumber = 1) {
    return {
        id, type: '4-1', level: 'NB', lesson: 'BÀI 1 — Phân số',
        content: `Giữ nguyên tiếng Việt, dấu ' và $${latex}$. Không đổi đáp án.`,
        options: { A: '1', B: { text: '2', image: 'data:image/png;base64,iVBORw0KGgo=' }, C: '3', D: '4' },
        answer: 'B', image: '',
        formulaSources: [{
            token: `__WMATH_${String(tokenNumber).padStart(6, '0')}__`, field: 'content',
            sourceType: 'omml', sourceOmml, latex, status: 'verified', engineVersion: 'word-omml-1.0'
        }],
        reviewPending: false, importIssues: []
    };
}
function batch(name, questions = [question(name + '-question01'), question(name + '-question02', 2)], hash = 'a') {
    return {
        batchId: 'batch-' + name + '-20261023', fileName: 'Kiểm thử dữ liệu Word.docx',
        sourceSha256: hash.repeat(64), engineVersion: 'word-omml-1.0', questions
    };
}
async function rowCount(db, table) {
    // table is always a fixed test-authored identifier, never user input.
    return (await db.query(`SELECT COUNT(*)::integer AS n FROM ${table}`)).rows[0].n;
}

test('PostgreSQL and actual Neon driver persist exact questions and original formula metadata in one transaction', async () => {
    const isolated = await isolatedDatabase();
    try {
        const payload = batch('exact');
        const result = await persistVerifiedWordImport(isolated.sql, 'teacher-exact', payload);
        assert.deepEqual(result, { success: true, batchId: payload.batchId, count: 2, expected: 2, formulaCount: 2 });
        const saved = (await isolated.db.query('SELECT * FROM questions ORDER BY id')).rows;
        assert.equal(saved.length, payload.questions.length);
        for (let i = 0; i < saved.length; i++) {
            const expected = payload.questions[i];
            for (const field of ['id', 'type', 'level', 'lesson', 'content', 'answer']) assert.equal(saved[i][field], expected[field]);
            assert.deepEqual(JSON.parse(saved[i].options), expected.options);
            assert.equal(saved[i].image, null);
            assert.equal(saved[i].creator_id, 'teacher-exact');
        }
        const sources = (await isolated.db.query('SELECT * FROM question_formula_sources ORDER BY question_id')).rows;
        assert.deepEqual(sources, payload.questions.map(q => ({
            question_id: q.id, source_token: q.formulaSources[0].token,
            field_name: 'content', source_type: 'omml', source_omml: sourceOmml,
            normalized_latex: latex, review_status: 'verified', engine_version: 'word-omml-1.0', batch_id: payload.batchId
        })));
        const transactions = isolated.requests.filter(request => Array.isArray(request.payload.queries));
        assert.equal(transactions.length, 1);
        assert.equal(transactions[0].isolation, 'Serializable');
        assert.equal(transactions[0].payload.queries.filter(query => /^INSERT INTO /i.test(query.query)).length, 7);
        assert.equal(isolated.requests.filter(request => !request.payload.queries && /^INSERT INTO /i.test(request.payload.query)).length, 0,
            'Neon query promises must stay lazy until their one transaction is submitted');
    } finally { await isolated.close(); }
});

test('A real primary-key failure in the middle of the import rolls back every earlier question, batch and formula row', async () => {
    const isolated = await isolatedDatabase();
    try {
        const payload = batch('rollback');
        const duplicateId = payload.questions[1].id;
        await isolated.db.query('INSERT INTO questions(id,content,creator_id) VALUES ($1,$2,$3)', [duplicateId, 'Dữ liệu gốc giữ nguyên', 'other-teacher']);
        await assert.rejects(persistVerifiedWordImport(isolated.sql, 'teacher-rollback', payload), error => error.code === '23505');
        assert.equal(await rowCount(isolated.db, 'questions'), 1);
        assert.deepEqual((await isolated.db.query('SELECT id,content,creator_id FROM questions')).rows,
            [{ id: duplicateId, content: 'Dữ liệu gốc giữ nguyên', creator_id: 'other-teacher' }]);
        for (const table of ['word_import_batches', 'word_import_items', 'question_formula_sources']) assert.equal(await rowCount(isolated.db, table), 0);
    } finally { await isolated.close(); }
});

test('The real unique constraint prevents importing the same file twice for one teacher without partial duplicate rows', async () => {
    const isolated = await isolatedDatabase();
    try {
        const first = batch('first-file');
        const second = batch('duplicate-file');
        await persistVerifiedWordImport(isolated.sql, 'same-teacher', first);
        await assert.rejects(persistVerifiedWordImport(isolated.sql, 'same-teacher', second), error => error.code === '23505');
        assert.equal(await rowCount(isolated.db, 'word_import_batches'), 1);
        assert.equal(await rowCount(isolated.db, 'questions'), 2);
        assert.equal(await rowCount(isolated.db, 'word_import_items'), 2);
        assert.equal(await rowCount(isolated.db, 'question_formula_sources'), 2);
        assert.deepEqual((await isolated.db.query('SELECT id FROM questions ORDER BY id')).rows.map(row => row.id), first.questions.map(q => q.id));
    } finally { await isolated.close(); }
});

test('Two teachers may import the same source hash while their question IDs, audit batches and read-back counts remain isolated', async () => {
    const isolated = await isolatedDatabase();
    try {
        const first = batch('teacher-a', [question('teacher-a-question01')]);
        const second = batch('teacher-b', [question('teacher-b-question01')]);
        const a = await persistVerifiedWordImport(isolated.sql, 'teacher-a', first);
        const b = await persistVerifiedWordImport(isolated.sql, 'teacher-b', second);
        assert.equal(a.count, 1);
        assert.equal(b.count, 1);
        assert.deepEqual((await isolated.db.query('SELECT id,creator_id FROM questions ORDER BY id')).rows,
            [{ id: first.questions[0].id, creator_id: 'teacher-a' }, { id: second.questions[0].id, creator_id: 'teacher-b' }]);
        assert.deepEqual((await isolated.db.query('SELECT id,creator_id,expected_count,imported_count FROM word_import_batches ORDER BY creator_id')).rows,
            [{ id: first.batchId, creator_id: 'teacher-a', expected_count: 1, imported_count: 1 },
                { id: second.batchId, creator_id: 'teacher-b', expected_count: 1, imported_count: 1 }]);
        const filteredReads = isolated.requests.filter(request => request.payload.query?.includes('q.creator_id=$2'));
        assert.ok(filteredReads.some(request => request.payload.params[0] === first.batchId && request.payload.params[1] === 'teacher-a'));
        assert.ok(filteredReads.some(request => request.payload.params[0] === second.batchId && request.payload.params[1] === 'teacher-b'));
    } finally { await isolated.close(); }
});

test('A database trigger that changes question content must abort and roll back the whole import', async () => {
    const isolated = await isolatedDatabase();
    try {
        await isolated.db.exec(`
            CREATE FUNCTION change_import_content() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN NEW.content := 'Dữ liệu bị thay đổi bởi trigger thử nghiệm'; RETURN NEW; END; $$;
            CREATE TRIGGER import_content_mismatch BEFORE INSERT ON questions
            FOR EACH ROW EXECUTE FUNCTION change_import_content();
        `);
        await assert.rejects(persistVerifiedWordImport(isolated.sql, 'teacher-mismatch', batch('mismatch')));
        for (const table of ['questions', 'word_import_batches', 'word_import_items', 'question_formula_sources']) {
            assert.equal(await rowCount(isolated.db, table), 0, 'No altered or partial import may remain in ' + table);
        }
    } finally { await isolated.close(); }
});

test('Read-back verifies the exact original formula metadata, not only its row count', async () => {
    const isolated = await isolatedDatabase();
    try {
        // Create the import schema through the same production function, then use a fresh file/hash.
        await persistVerifiedWordImport(isolated.sql, 'teacher-source', batch('before-trigger'));
        await isolated.db.exec(`
            CREATE FUNCTION change_formula_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN NEW.normalized_latex := 'corrupted-source'; RETURN NEW; END; $$;
            CREATE TRIGGER formula_metadata_mismatch BEFORE INSERT ON question_formula_sources
            FOR EACH ROW EXECUTE FUNCTION change_formula_metadata();
        `);
        await assert.rejects(persistVerifiedWordImport(isolated.sql, 'teacher-source', batch('after-trigger', undefined, 'b')));
        assert.equal(await rowCount(isolated.db, 'word_import_batches'), 1);
        assert.equal(await rowCount(isolated.db, 'questions'), 2);
        assert.equal(await rowCount(isolated.db, 'word_import_items'), 2);
        assert.equal(await rowCount(isolated.db, 'question_formula_sources'), 2);
        assert.equal((await isolated.db.query('SELECT COUNT(*)::integer AS n FROM question_formula_sources WHERE normalized_latex=$1', ['corrupted-source'])).rows[0].n, 0);
    } finally { await isolated.close(); }
});
