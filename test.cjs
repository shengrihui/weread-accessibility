const assert = require('node:assert/strict');
const {linesFromRuns,paragraphsFromLines} = require('./weread-accessibility.user.js');
const run = (text,x,y,size=20) => ({text,x,y,size});
assert.deepEqual(linesFromRuns([run('乙',20,30),run('甲',0,30),run('丙',0,60)]).map(x=>x.text),['甲乙','丙']);
assert.equal(linesFromRuns([run('旧',0,30),run('新',0,30),run('新',0,30)])[0].text,'新');
assert.equal(linesFromRuns([run('甲',0,30),run('乙',20,31)])[0].text,'甲乙');
assert.equal(paragraphsFromLines(linesFromRuns([run('第一段',40,30),run('续行',0,60),run('第二段',40,90)])).length,2);
assert.equal(paragraphsFromLines(linesFromRuns([run('甲',0,30),run('乙',0,100)])).length,2);
assert.deepEqual(paragraphsFromLines([]),[]);
// Observed WeRead layout: 21px text, 40px normal line spacing, 62px paragraph spacing.
const actual=paragraphsFromLines(linesFromRuns([
  run('第一行',0,122.708,21),run('第二行',0,162.710,21),run('第三行',0,203.713,21),
  run('下一段',0,265.717,21),run('续行',0,305.720,21)
]));
assert.deepEqual(actual.map(p=>p.text),['第一行第二行第三行','下一段续行']);
const changedFont=paragraphsFromLines(linesFromRuns([
  run('大字号首行',0,100,28),run('续行',0,156,28),run('另段',0,240,28)
]));
assert.deepEqual(changedFont.map(p=>p.text),['大字号首行续行','另段']);
assert.equal(paragraphsFromLines(linesFromRuns([run('标题',0,50,40),run('正文',0,90,20),run('续行',0,130,20)])).length,2);
// A scroll-mode text layer keeps later laid-out text, including beyond the viewport.
assert.equal(paragraphsFromLines(linesFromRuns([run('顶部',0,30),run('下方',0,1500)]))[1].text,'下方');
console.log('PASS: ordering, repaint deduplication, line tolerance, paragraph boundaries, empty page, offscreen text');
