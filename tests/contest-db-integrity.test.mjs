import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync('migrations/20261115_contest_mode.sql','utf8')
  .split('-- Read-only post-migration verification:')[0];

test('Real PostgreSQL migration, participant uniqueness and safe attempt states',async()=>{
 const db=new PGlite();
 try{
   await db.exec(`
     CREATE TABLE app_settings(id integer PRIMARY KEY,app_title text);
     INSERT INTO app_settings(id,app_title) VALUES(1,'Demo');
     CREATE TABLE exam_configs(
       id text PRIMARY KEY, name text, creator_id text,
       chedodethi text, created_at text, updated_at text
     );
     CREATE TABLE results(
       id text PRIMARY KEY, exam_id text, created_at text, score numeric
     );
   `);
   await db.exec(migration);
   const settings=await db.query('SELECT application_mode FROM app_settings WHERE id=1');
   assert.equal(settings.rows[0].application_mode,'school');
   const columns=await db.query(`SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='contest_participants'`);
   assert.ok(columns.rows.length>=10);
   for(const row of columns.rows)assert.match(row.column_name,/^[a-z][a-z0-9_]*$/);

   await db.query(`INSERT INTO contest_participants
     (ma_nguoi_du_thi,ho_ten,don_vi,so_dien_thoai_ma_hoa,ma_dinh_danh_bam,thoi_diem_dong_y)
     VALUES
     ('p1','Nguyen Van A','Lop 12','encrypted-1','hash-1',now()),
     ('p2','Nguyen Van B','Lop 12','encrypted-2','hash-2',now())`);
   await db.query(`INSERT INTO contest_attempts
     (ma_phien_thi,ma_nguoi_du_thi,ma_de_thi) VALUES
     ('session-a','p1','contest-1'),('session-b','p2','contest-1')`);
   await assert.rejects(db.query(`INSERT INTO contest_attempts
     (ma_phien_thi,ma_nguoi_du_thi,ma_de_thi)
     VALUES('parallel-a','p1','contest-1')`),/unique|duplicate/i);
   await assert.rejects(db.query(`UPDATE contest_attempts
     SET trang_thai='UNKNOWN' WHERE ma_phien_thi='session-a'`),/check|constraint/i);
   await db.query(`UPDATE contest_attempts SET trang_thai='DA_NOP'
     WHERE ma_phien_thi='session-a'`);
   await db.query(`INSERT INTO contest_attempts
     (ma_phien_thi,ma_nguoi_du_thi,ma_de_thi)
     VALUES('session-c','p1','contest-1')`);
   const attempts=await db.query(`SELECT ma_nguoi_du_thi,
     COUNT(*)::integer AS so_luot FROM contest_attempts
     GROUP BY ma_nguoi_du_thi ORDER BY ma_nguoi_du_thi`);
   assert.deepEqual(attempts.rows.map(x=>[x.ma_nguoi_du_thi,x.so_luot]),
     [['p1',2],['p2',1]]);
   await db.exec(migration); // must be idempotent
   const again=await db.query(`SELECT count(*)::integer AS count FROM contest_attempts`);
   assert.equal(again.rows[0].count,3);
 }finally {await db.close();}
});
