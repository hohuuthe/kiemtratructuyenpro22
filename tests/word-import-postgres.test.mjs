import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { neon, neonConfig } from '@neondatabase/serverless';
import { persistVerifiedWordImport,deriveWordImportIds } from '../functions/api/questions/import-word.ts';

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

test('PostgreSQL saves every question exactly in existing schema without DDL',async()=>{
 const isolated=await isolatedDatabase();
 try{
  const b=batch('exact'),out=await persistVerifiedWordImport(isolated.sql,'teacher',b);
  assert.equal(out.count,2);
  assert.equal(out.duplicate,false);
  const saved=(await isolated.db.query('SELECT * FROM questions ORDER BY id')).rows;
  assert.equal(saved.length,2);
  assert.equal(saved[0].content,b.questions[0].content);
  const all=(await isolated.db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(x=>x.table_name);
  assert.deepEqual(all,['questions']);
  assert.equal(isolated.requests.filter(x=>Array.isArray(x.payload.queries)).length,1);
  assert.ok(!isolated.requests.some(x=>/CREATE TABLE|word_import_batches|word_import_items|question_formula_sources/i.test(JSON.stringify(x.payload))));
 }finally{await isolated.close();}
});
test('Retry same file is idempotent, never creates duplicate questions',async()=>{
 const isolated=await isolatedDatabase();
 try{
  const b=batch('retry');
  await persistVerifiedWordImport(isolated.sql,'teacher',b);
  const again=await persistVerifiedWordImport(isolated.sql,'teacher',b);
  assert.equal(again.duplicate,true);
  assert.equal((await isolated.db.query('SELECT COUNT(*)::int AS n FROM questions')).rows[0].n,2);
 }finally{await isolated.close();}
});
test('Import collision or prior change is rejected without overwrite',async()=>{
 const isolated=await isolatedDatabase();
 try{
  const b=batch('changed');
  await persistVerifiedWordImport(isolated.sql,'teacher',b);
  await isolated.db.query('UPDATE questions SET content=$1 WHERE id=$2',['TEACHER EDIT', (await isolated.db.query('SELECT id FROM questions LIMIT 1')).rows[0].id]);
  await assert.rejects(persistVerifiedWordImport(isolated.sql,'teacher',b),/không ghi đè/);
  assert.equal((await isolated.db.query("SELECT COUNT(*)::int AS n FROM questions WHERE content='TEACHER EDIT'")).rows[0].n,1);
 }finally{await isolated.close();}
});
test('Mid-transaction collision rolls back all earlier INSERTs',async()=>{
 const isolated=await isolatedDatabase();
 try{
  const b=batch('collision');const ids=await deriveWordImportIds('teacher',b.sourceSha256,b.questions.length);
  await isolated.db.query('INSERT INTO questions(id,content,creator_id) VALUES ($1,$2,$3)',[ids[1],'EXISTING','another-teacher']);
  await assert.rejects(persistVerifiedWordImport(isolated.sql,'teacher',b));
  assert.deepEqual((await isolated.db.query('SELECT id,content FROM questions')).rows,[{id:ids[1],content:'EXISTING'}]);
 }finally{await isolated.close();}
});
test('Postgres trigger changes content: verification aborts transaction',async()=>{
 const isolated=await isolatedDatabase();
 try{
  await isolated.db.exec("CREATE FUNCTION tamper() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.content := 'WRONG'; RETURN NEW; END $$; CREATE TRIGGER tamper_q BEFORE INSERT ON questions FOR EACH ROW EXECUTE FUNCTION tamper();");
  await assert.rejects(persistVerifiedWordImport(isolated.sql,'teacher',batch('tamper')));
  assert.equal((await isolated.db.query('SELECT COUNT(*)::int AS n FROM questions')).rows[0].n,0);
 }finally{await isolated.close();}
});
test('Same source for two teachers receives independent deterministic IDs',async()=>{
 const isolated=await isolatedDatabase();
 try{
  const a=batch('teacher-a');const b=batch('teacher-b');
  await persistVerifiedWordImport(isolated.sql,'teacher-a',a);
  await persistVerifiedWordImport(isolated.sql,'teacher-b',b);
  const rows=(await isolated.db.query('SELECT id,creator_id FROM questions')).rows;
  assert.equal(rows.length,4);
  assert.equal(new Set(rows.map(x=>x.id)).size,4);
 }finally{await isolated.close();}
});
