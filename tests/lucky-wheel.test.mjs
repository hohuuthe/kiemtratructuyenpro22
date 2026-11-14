import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classChoices, classRoster, wheelStorageKey, reconcileWheelState,
  availableStudents, randomWheelIndex, nextWheelRotation, finishPendingWheelResult
} from '../src/lucky-wheel-core.js';

const people = [
  { id:'s1', full_name:'Nguyễn Văn An', donvi:'Trường A', lop:'10A1',target_audience:'Học sinh'},
  { id:'s2', full_name:'Trần Thị Bình', donvi:'Trường A', lop:'10A1',target_audience:'student'},
  { id:'s3', full_name:'Lê Hùng', donvi:'Trường A', lop:'10A2',target_audience:'Học sinh'},
  { id:'s4', full_name:'Phạm Lan', donvi:'Trường B', lop:'10A1',target_audience:'Học sinh'},
  { id:'t1', full_name:'Giáo viên', donvi:'Trường A', lop:'10A1',target_audience:'Giáo viên'}
];
const assignments = [
  {class_name:'10A1',donvi:'Trường A'},
  {class_name:'10A2',donvi:'Trường A'}
];

test('teacher receives only assigned classes, matched by school AND class, excluding teachers', () => {
  assert.deepEqual(classChoices(people,assignments,false).map(c=>c.className),['10A1','10A2']);
  assert.deepEqual(classRoster(people,assignments,false,'Trường A','10A1').map(s=>s.id),['s1','s2']);
  assert.deepEqual(classRoster(people,assignments,false,'Trường B','10A1'),[]);
  assert.deepEqual(classRoster(people,assignments,false,'Trường A','11A1'),[]);
  assert.deepEqual(classChoices(people,assignments,true).map(c=>c.unit),
    ['Trường A','Trường A','Trường B']);
});

test('class state persisted by tenant, teacher, unit and class without collisions',()=>{
  const a = wheelStorageKey({tenant:'a',teacherId:'teacher1',unit:'Trường A',className:'10A1'});
  const keys = [
    wheelStorageKey({tenant:'b',teacherId:'teacher1',unit:'Trường A',className:'10A1'}),
    wheelStorageKey({tenant:'a',teacherId:'teacher2',unit:'Trường A',className:'10A1'}),
    wheelStorageKey({tenant:'a',teacherId:'teacher1',unit:'Trường B',className:'10A1'}),
    wheelStorageKey({tenant:'a',teacherId:'teacher1',unit:'Trường A',className:'10A2'})
  ];
  keys.forEach(key=>assert.notEqual(key,a));
});

test('deleted or transferred students cannot be restored into current roster',()=>{
  const roster=classRoster(people,assignments,false,'Trường A','10A1');
  const restored=reconcileWheelState({
    excluded:['s1','s4','s1','ghost'],
    called:['s2','ghost'], history:['s2','ghost'],
    lastId:'ghost', pendingId:'s4'
  },roster);
  assert.deepEqual(restored,{excluded:['s1'],called:['s2'],history:['s2'],lastId:null,pendingId:null});
  assert.deepEqual(availableStudents(roster,restored),[]);
});

test('refresh after pending draw settles SAME winner once without a second draw',()=>{
  const roster=classRoster(people,assignments,false,'Trường A','10A1');
  const incomplete=reconcileWheelState({pendingId:'s2',called:[],history:[]},roster);
  const finalized=finishPendingWheelResult(incomplete);
  assert.deepEqual(finalized.called,['s2']);
  assert.deepEqual(finalized.history,['s2']);
  assert.equal(finalized.lastId,'s2');
  assert.equal(finalized.pendingId,null);
  assert.deepEqual(finishPendingWheelResult(finalized),finalized);
});

test('unbiased crypto picker supports 1, 42 and 50 students and rejects out-of-range sample',()=>{
  let next=[4294967295,52];
  const rng={getRandomValues(arr){arr[0]=next.shift()??0;return arr;}};
  assert.equal(randomWheelIndex(42,rng),10);
  assert.equal(randomWheelIndex(1,rng),0);
  assert.throws(()=>randomWheelIndex(0,rng),RangeError);
  assert.throws(()=>randomWheelIndex(2,{}),/ngẫu nhiên/);
  for(let length=1;length<=55;length++){
    const generator={getRandomValues(arr){arr[0]=12345678;return arr;}};
    const result=randomWheelIndex(length,generator);
    assert.ok(result>=0 && result<length);
  }
});

test('animation ends with selected sector centered under the fixed top pointer',()=>{
  const tau=2*Math.PI;
  for(const count of [1,2,12,42,50]){
    for(let winner=0;winner<count;winner++){
      const rotation=nextWheelRotation(4.8,winner,count,7);
      assert.ok(rotation>4.8+tau*6);
      const remainder=((rotation+winner*tau/count)%tau+tau)%tau;
      assert.ok(Math.min(remainder,tau-remainder)<1e-8,`sector count=${count}, index=${winner}`);
    }
  }
});

test('integration keeps private lazy loaded tab, two custom audio inputs and teacher-only menu',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../public/components/tab-lucky-wheel.html',import.meta.url),'utf8');
  const module=readFileSync(new URL('../src/lucky-wheel-ui.js',import.meta.url),'utf8');
  assert.match(main,/protectedTabs=.*'lucky-wheel'/);
  assert.match(main,/tab === 'lucky-wheel'/);
  assert.match(main,/import\('\.\/lucky-wheel-ui\.js'\)/);
  assert.match(main,/__resetLuckyWheel/);
  assert.match(html,/data-sidebar-tab="lucky-wheel" class="sidebar-nav-item hidden/);
  assert.match(html,/id="tab-lucky-wheel"/);
  assert.match(panel,/id="lw-spin-file"/);
  assert.match(panel,/id="lw-applause-file"/);
  assert.match(panel,/id="lw-muted"/);
  assert.match(module,/indexedDB\.open/);
  assert.match(module,/window\.currentTeacherAssignments/);
  assert.match(module,/randomWheelIndex/);
  assert.doesNotMatch(module,/fetch\(.+upload|\/api\/upload-image/);
});
