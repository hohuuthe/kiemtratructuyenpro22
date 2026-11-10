/**
 * Select a strict, immutable exam Word question pool. Never replace a missing
 * difficulty level with questions from another level.
 */
export function selectExactExamWordQuestions(pool, config, shuffle) {
  if (!Array.isArray(pool) || !config || typeof shuffle !== 'function')
    throw new Error('Dữ liệu bốc câu hỏi xuất Word không hợp lệ.');
  const label=String(config.typeLabel||'câu hỏi');
  const total=Number(config.targetCount);
  const byLevel={
    NB:Number(config.nbTarget||0),
    TH:Number(config.thTarget||0),
    VD:Number(config.vdTarget||0)
  };
  if (![total,...Object.values(byLevel)].every(n=>Number.isSafeInteger(n)&&n>=0))
    throw new Error('Số câu theo mức độ của '+label+' không hợp lệ.');
  if (!total) return [];
  const ids=new Set(pool.map(q=>String(q.id||'')));
  if (ids.size!==pool.length || ids.has(''))
    throw new Error('Ngân hàng câu hỏi có ID bị trùng hoặc trống.');
  if (pool.length<total)
    throw new Error('Không đủ '+label+': cần '+total+' câu, chỉ có '+pool.length+' câu.');
  const sum=byLevel.NB+byLevel.TH+byLevel.VD;
  if (sum&&sum!==total)
    throw new Error('Cấu hình '+label+' có tổng NB/TH/VD '+sum+' khác tổng số câu '+total+'.');
  if (!sum) return shuffle(pool).slice(0,total);
  const result=[];
  for (const level of ['NB','TH','VD']) {
    const required=byLevel[level];
    if (!required) continue;
    const available=pool.filter(q=>q.level===level);
    if (available.length<required)
      throw new Error('Đề không còn hợp lệ: '+label+' mức '+level+
        ' cần '+required+' câu, thực tế '+available.length+
        '. Không tự lấy câu mức độ khác để bù.');
    result.push(...shuffle(available).slice(0,required));
  }
  if (result.length!==total) throw new Error('Bốc câu hỏi không khớp cấu hình '+label+'.');
  return result;
}
