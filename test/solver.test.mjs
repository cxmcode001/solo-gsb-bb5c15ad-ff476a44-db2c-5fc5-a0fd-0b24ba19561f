// 求解器单元测试：node test/solver.test.mjs
// 先用 tsc 将 src/solver.ts 编译到临时目录，再运行断言。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'solver-test-'));
execFileSync('npx', ['tsc', 'src/solver.ts', '--outDir', outDir, '--module', 'ES2020', '--target', 'ES2020', '--moduleResolution', 'bundler', '--skipLibCheck'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
});
// tsc 输出为 ESM 但无 package.json 类型声明，改名为 .mjs 以便 import
const { renameSync } = await import('node:fs');
renameSync(join(outDir, 'solver.js'), join(outDir, 'solver.mjs'));
const solver = await import(pathToFileURL(join(outDir, 'solver.mjs')).href);

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const network = {
  nodes: ['S1', 'S2', 'N1', 'N2', 'N3', 'N4', 'A', 'B', 'C', 'D'],
  pipes: [
    { id: 'P1', from: 'A', to: 'N2' },
    { id: 'P2', from: 'C', to: 'N3' },
  ],
  valvedPipes: [
    { id: 'V01', from: 'S1', to: 'N1', open: true },
    { id: 'V02', from: 'S2', to: 'N4', open: true },
    { id: 'V03', from: 'N1', to: 'N2', open: true },
    { id: 'V04', from: 'N2', to: 'N3', open: true },
    { id: 'V05', from: 'N3', to: 'N4', open: true },
    { id: 'V06', from: 'N4', to: 'N1', open: true },
    { id: 'V07', from: 'D', to: 'N3', open: true },
    { id: 'V08', from: 'B', to: 'N1', open: true },
    { id: 'V09', from: 'B', to: 'N4', open: false },
  ],
};
const query = { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['B', 'C', 'D'] };

console.log('基本求解：');
const r1 = solver.solve(network, query);
check('返回 ok', r1.status === 'ok');
check('最少关阀数为 2', r1.minClosed === 2);
check('唯一最优方案为 [V03, V04]', r1.solutions.length === 1 && r1.solutions[0].closed.join(',') === 'V03,V04');
check('漏点已隔离', r1.solutions[0].leakIsolated === true);
check('全部出口连通', r1.solutions[0].outletStatus.every((o) => o.connected));
check('出口 B 可达 S1', r1.solutions[0].outletStatus.find((o) => o.outlet === 'B').reachableSupplies.includes('S1'));

console.log('输入不被修改：');
const before = JSON.stringify(network);
solver.solve(network, query);
check('求解后 network 未变化', JSON.stringify(network) === before);

console.log('无需关阀（漏点本就隔离）：');
const r2 = solver.solve(network, { supplies: ['S1'], leak: 'D', outlets: ['A'] });
// D 通过 V07 连到 N3... S1 可达 N3，所以 D 并未隔离 —— 构造真正隔离的场景：
const isoNet = {
  nodes: ['S1', 'X', 'Y'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S1', to: 'X', open: true },
    { id: 'V2', from: 'Y', to: 'X', open: false },
  ],
};
const r2b = solver.solve(isoNet, { supplies: ['S1'], leak: 'Y', outlets: ['X'] });
check('漏点已天然隔离时关阀数为 0', r2b.status === 'ok' && r2b.minClosed === 0 && r2b.solutions[0].closed.length === 0);
void r2;

console.log('无解场景：');
const r3 = solver.solve(network, { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['A'] });
check('保供出口与漏点同管段时无解', r3.status === 'no-solution');

console.log('字典序取舍：');
// S—V1—M—V2—L 为串联：关闭 V1 或 V2 都能隔离漏点，
// 两个等价的最小方案 [V1] 与 [V2]，字典序应优先 [V1]
const tieNet = {
  nodes: ['S', 'M', 'L', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V2', from: 'M', to: 'L', open: true },
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V3', from: 'O', to: 'S', open: true },
  ],
};
const r4 = solver.solve(tieNet, { supplies: ['S'], leak: 'L', outlets: ['O'] });
check('并列方案均列出且按字典序排列', r4.status === 'ok' && r4.minClosed === 1 &&
  r4.solutions.length === 2 && r4.solutions[0].closed[0] === 'V1' && r4.solutions[1].closed[0] === 'V2');

console.log('校验：');
const r5 = solver.solve(network, { supplies: ['S1', 'N2'], leak: 'N2', outlets: [] });
check('漏点不能是供水点', r5.status === 'invalid');
const dup = solver.parseNetwork({ nodes: ['a', 'b'], pipes: [], valvedPipes: [
  { id: 'V1', from: 'a', to: 'b', open: true },
  { id: 'V1', from: 'b', to: 'a', open: true },
] });
check('阀门编号重复被拒绝', !dup.network && dup.errors.some((e) => e.includes('重复')));
const many = solver.parseNetwork({
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 13 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: true })),
});
const r6 = solver.solve(many.network, { supplies: ['a'], leak: 'b', outlets: [] });
check('超过 12 个开启阀门被拒绝', r6.status === 'invalid' && r6.errors.some((e) => e.includes('13')));

// ============ 保供韧性巡检 ============
console.log('保供韧性巡检：');

const findRow = (r, name) => r.rows.find((x) => x.outlet === name);

const ir1 = solver.inspectResilience(network, { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['B', 'C', 'D', 'N2'] });
check('返回 ok', ir1.status === 'ok');
// B：V08 与 V09(已关) 并行，仅 V08 可用 → 1
const iB = findRow(ir1, 'B');
check('出口 B 至少需失效 1 条（已关阀不参与）', iB.assessable && iB.minFailures === 1 && iB.witnessPipes.join(',') === 'V08');
// C：经单条无阀管段 P2 挂在环上 → 1（无阀管段按单条计）
const iC = findRow(ir1, 'C');
check('出口 C 至少需失效 1 条（无阀管段 P2）', iC.assessable && iC.minFailures === 1 && iC.witnessPipes.join(',') === 'P2');
// D：仅 V07 单管 → 1
const iD = findRow(ir1, 'D');
check('出口 D 至少需失效 1 条', iD.assessable && iD.minFailures === 1 && iD.witnessPipes.join(',') === 'V07');
// N2 位于环路中：须同时切断 V03、V04 两条管段
const iN2 = findRow(ir1, 'N2');
check('环路上的 N2 至少需失效 2 条（环路分别计数）', iN2.assessable && iN2.minFailures === 2 && iN2.witnessPipes.join(',') === 'V03,V04');
check('结果按失效数升序（1,1,1,2）', ir1.rows.map((x) => x.minFailures).join(',') === '1,1,1,2');
check('参与计数管段数（2 无阀 + 8 开启阀门，排除已关 V09）', ir1.activePipeCount === 10);

console.log('巡检：已断水出口为 0 和空清单：');
// 仅经一条关闭阀门挂在网上的出口
const cutNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const ir2 = solver.inspectResilience(cutNet, { supplies: ['S'], leak: '', outlets: ['O'] });
const r2row = ir2.rows[0];
check('已断水出口 minFailures=0', r2row.assessable && r2row.minFailures === 0);
check('已断水出口为空清单', Array.isArray(r2row.witnessPipes) && r2row.witnessPipes.length === 0);
check('已断水出口标记 alreadyCut', r2row.alreadyCut === true);

console.log('巡检：并行管段分别计数：');
const parNet = {
  nodes: ['S', 'O'],
  pipes: [
    { id: 'P1', from: 'S', to: 'O' },
    { id: 'P2', from: 'S', to: 'O' },
  ],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'O', open: true },
  ],
};
const ir3 = solver.inspectResilience(parNet, { supplies: ['S'], leak: '', outlets: ['O'] });
const r3row = ir3.rows[0];
check('3 条并行管段 → 需失效 3 条', r3row.assessable && r3row.minFailures === 3);
check('割清单含全部 3 条并行管段', r3row.witnessPipes.length === 3 &&
  ['P1', 'P2', 'V1'].every((p) => r3row.witnessPipes.includes(p)));

console.log('巡检：多供水点作为整体：');
// O 经 P1 连 S1、经 V1 连 S2：必须两条都失效才失去全部供水
const multiNet = {
  nodes: ['S1', 'S2', 'O'],
  pipes: [{ id: 'P1', from: 'S1', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S2', to: 'O', open: true }],
};
const ir4 = solver.inspectResilience(multiNet, { supplies: ['S1', 'S2'], leak: '', outlets: ['O'] });
check('双供水点分别单管接入 → 需失效 2 条', ir4.rows[0].minFailures === 2);
const ir4b = solver.inspectResilience(multiNet, { supplies: ['S1'], leak: '', outlets: ['O'] });
check('只算一个供水点时 → 需失效 1 条', ir4b.rows[0].minFailures === 1);

console.log('巡检：出口与供水点同名：');
const ir5 = solver.inspectResilience(network, { supplies: ['S1'], leak: '', outlets: ['S1', 'B'] });
const same = findRow(ir5, 'S1');
check('同名出口标记无法评估', same.assessable === false && same.reason.includes('无法按管段失效评估'));
check('无法评估排在升序结果最后', ir5.rows[1].outlet === 'S1');

console.log('巡检：无阀管段按单条计且能出现在割中：');
const pNet = {
  nodes: ['S', 'M', 'O'],
  pipes: [{ id: 'P1', from: 'M', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'M', open: true }],
};
const ir6 = solver.inspectResilience(pNet, { supplies: ['S'], leak: '', outlets: ['O'] });
check('串联无阀管段场景需失效 1 条', ir6.rows[0].minFailures === 1);
check('割可以是无阀管段 P1 或带阀管段 V1', ['P1', 'V1'].includes(ir6.rows[0].witnessPipes[0]));

console.log('巡检：校验与纯函数：');
const ir7 = solver.inspectResilience(network, { supplies: ['NOPE'], leak: '', outlets: ['B'] });
check('供水点不存在时报错', ir7.status === 'invalid');
const ir8 = solver.inspectResilience(network, { supplies: ['S1'], leak: '', outlets: ['NOPE'] });
check('出口不存在时报错', ir8.status === 'invalid');
const ir9 = solver.inspectResilience(network, { supplies: [], leak: '', outlets: ['B'] });
check('缺少供水点时报错', ir9.status === 'invalid');
const beforeInsp = JSON.stringify(network);
solver.inspectResilience(network, { supplies: ['S1', 'S2'], leak: '', outlets: ['B', 'C'] });
check('巡检不修改输入网络', JSON.stringify(network) === beforeInsp);
// 不受 12 个开启阀门上限影响（巡检为多项式最大流，非组合枚举）
const ir10 = solver.inspectResilience(many.network, { supplies: ['a'], leak: '', outlets: ['b'] });
check('巡检不受开启阀门 12 个上限影响', ir10.status === 'ok' && ir10.rows[0].minFailures === 13);

// 不受 12 个开启阀门上限影响（核验同样为多项式最大流，不受组合枚举上限约束；见下方核验分区断言）
void many;

// ============ 供水能力核验 ============
console.log('供水能力核验：');

const findCapRow = (r, name) => r.rows.find((x) => x.outlet === name);
const groupKinds = (r) => r.cutGroups.map((g) => g.kind);
const groupOf = (r, kind) => r.cutGroups.find((g) => g.kind === kind);

console.log('核验：单管串联与供给上限约束：');
const chainNet = {
  nodes: ['S1', 'M', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S1', to: 'M', open: true },
    { id: 'V2', from: 'M', to: 'O', open: true },
  ],
};
// 供给上限 1 卡总供给：割为供给上限 1
const c1 = solver.verifyCapacity(chainNet, { supplyCaps: { S1: 1 }, outletDemands: { O: 3 } });
check('返回 ok', c1.status === 'ok');
check('总分配为 1、总缺口为 2', c1.totalAllocated === 1 && c1.totalGap === 2);
check('出口 O 获配 1、缺口 2、可达', (() => {
  const row = findCapRow(c1, 'O');
  return row.demand === 3 && row.allocated === 1 && row.gap === 2 && row.reachable === true;
})());
check('最小割为供给上限 S1（容量 1）', groupKinds(c1).join(',') === 'supply' &&
  groupOf(c1, 'supply').items.join(',') === 'S1' && groupOf(c1, 'supply').capacity === 1);
check('割容量等于总分配量', c1.cutCapacity === c1.totalAllocated);

console.log('核验：管段容量约束：');
// 供给充裕但串联管段每条容量 1
const c2 = solver.verifyCapacity(chainNet, { supplyCaps: { S1: 5 }, outletDemands: { O: 5 } });
check('总分配受单根管段限制为 1、缺口 4', c2.totalAllocated === 1 && c2.totalGap === 4);
check('最小割为管段 V1（容量 1）', groupKinds(c2).join(',') === 'pipe' &&
  groupOf(c2, 'pipe').items.join(',') === 'V1' && groupOf(c2, 'pipe').capacity === 1);

console.log('核验：出口需求约束（并行管段可绕过管容）：');
const par2Net = {
  nodes: ['S', 'O'],
  pipes: [
    { id: 'P1', from: 'S', to: 'O' },
    { id: 'P2', from: 'S', to: 'O' },
  ],
  valvedPipes: [],
};
const c3 = solver.verifyCapacity(par2Net, { supplyCaps: { S: 5 }, outletDemands: { O: 1 } });
check('需求仅 1 时总分配 1、缺口 0', c3.totalAllocated === 1 && c3.totalGap === 0);
check('最小割为出口需求 O（容量 1）', groupKinds(c3).join(',') === 'outlet' &&
  groupOf(c3, 'outlet').items.join(',') === 'O');
// 需求大于 2 条并行管容量时受管段限制
const c3b = solver.verifyCapacity(par2Net, { supplyCaps: { S: 5 }, outletDemands: { O: 5 } });
check('需求 5 时总分配 2（两条并行管各计 1）', c3b.totalAllocated === 2 && c3b.totalGap === 3);
check('最小割为两条并行管段（容量 2）', groupKinds(c3b).join(',') === 'pipe' &&
  groupOf(c3b, 'pipe').items.join(',') === 'P1,P2' && groupOf(c3b, 'pipe').capacity === 2);

console.log('核验：多供水点上限与多出口需求同时约束：');
// 环形测试网：S1、S2 经各自单管 V01/V02 接入环，B/C/D 各经单管挂环
const c4 = solver.verifyCapacity(network, {
  supplyCaps: { S1: 2, S2: 1 },
  outletDemands: { B: 1, C: 1, D: 1 },
});
check('总分配 2（V01+V02 各只能过 1）、总缺口 1', c4.totalAllocated === 2 && c4.totalGap === 1);
check('供给上限合计 3、需求合计 3', c4.totalSupplyCap === 3 && c4.totalDemand === 3);
check('三个出口各获配 0 或 1，获配合计 2', c4.rows.every((x) => [0, 1].includes(x.allocated)) &&
  c4.rows.reduce((s, x) => s + x.allocated, 0) === 2);
check('缺口合计等于总缺口', c4.rows.reduce((s, x) => s + x.gap, 0) === c4.totalGap);
check('割中同时含供给上限与管段两类项目', groupKinds(c4).includes('supply') && groupKinds(c4).includes('pipe'));
check('割容量等于总分配量', c4.cutCapacity === 2 && c4.cutCapacity === c4.totalAllocated);

console.log('核验：多源多汇分支网（供给上限同时卡总分配）：');
const diamondNet = {
  nodes: ['S1', 'S2', 'M', 'O1', 'O2'],
  pipes: [
    { id: 'P1', from: 'S1', to: 'M' },
    { id: 'P2', from: 'S2', to: 'M' },
    { id: 'P3', from: 'M', to: 'O1' },
    { id: 'P4', from: 'M', to: 'O2' },
  ],
  valvedPipes: [],
};
const c5 = solver.verifyCapacity(diamondNet, {
  supplyCaps: { S1: 1, S2: 1 },
  outletDemands: { O1: 2, O2: 2 },
});
check('总分配 2、总缺口 2', c5.totalAllocated === 2 && c5.totalGap === 2);
check('O1、O2 各获配 1', findCapRow(c5, 'O1').allocated === 1 && findCapRow(c5, 'O2').allocated === 1);
check('最小割为两个供水点供给上限（容量 2）', groupKinds(c5).join(',') === 'supply' &&
  groupOf(c5, 'supply').items.join(',') === 'S1,S2');

console.log('核验：已关阀不参与、断水出口获配 0：');
const cutValveNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const c6 = solver.verifyCapacity(cutValveNet, { supplyCaps: { S: 5 }, outletDemands: { O: 2 } });
check('连通管段数仅 1（已关 V2 不计）', c6.activePipeCount === 1);
check('总分配 0、缺口等于需求', c6.totalAllocated === 0 && c6.totalGap === 2);
check('出口标记不可达、获配 0、缺口 2', (() => {
  const row = findCapRow(c6, 'O');
  return row.allocated === 0 && row.gap === 2 && row.reachable === false;
})());
check('割为空清单', Array.isArray(c6.cutGroups) && c6.cutGroups.length === 0);

console.log('核验：零上限供水点与零需求出口不列入割：');
const zeroNet = {
  nodes: ['S1', 'S2', 'O1', 'O2'],
  pipes: [{ id: 'P1', from: 'S1', to: 'O1' }],
  valvedPipes: [{ id: 'V1', from: 'S2', to: 'O2', open: true }],
};
const c7 = solver.verifyCapacity(zeroNet, {
  supplyCaps: { S1: 0, S2: 3 },
  outletDemands: { O1: 0, O2: 2 },
});
check('总分配 1（V1 单管容量 1）', c7.totalAllocated === 1);
check('O1 需求 0 获配 0 缺口 0', (() => { const r = findCapRow(c7, 'O1'); return r.demand === 0 && r.allocated === 0 && r.gap === 0; })());
check('割中不含零容量供给上限/需求，仅管段 V1', groupKinds(c7).join(',') === 'pipe' &&
  groupOf(c7, 'pipe').items.join(',') === 'V1');

console.log('核验：出口与供水点同名：');
const sameNet = {
  nodes: ['S1', 'O'],
  pipes: [{ id: 'P1', from: 'S1', to: 'O' }],
  valvedPipes: [],
};
// S1 同时是供水点与出口：其供给上限同时约束自身获配与外送
const c8 = solver.verifyCapacity(sameNet, { supplyCaps: { S1: 3 }, outletDemands: { S1: 2, O: 1 } });
check('同名节点 S1 直接获配 2，另一个出口经单管获配 1', c8.totalAllocated === 3 &&
  findCapRow(c8, 'S1').allocated === 2 && findCapRow(c8, 'O').allocated === 1);
check('全部满足，总缺口 0', c8.totalGap === 0);
// 供给上限同时要供自身与外送时也构成约束：上限 2、自身需求 2，外送口得不到水
const c8b = solver.verifyCapacity(sameNet, { supplyCaps: { S1: 2 }, outletDemands: { S1: 2, O: 1 } });
check('同名节点供给上限同时约束自身与外送（自身 2、O 获配 0）', c8b.totalAllocated === 2 &&
  findCapRow(c8b, 'S1').allocated === 2 && findCapRow(c8b, 'O').allocated === 0);

console.log('核验：同一无向管段双向合计只占用一次（菱形换向）：');
// S1、S2 两源与 O1、O2 两口，中间仅靠一条管段 M? 构造：
// S1-M (P1), S2-M (P2), M-O1 (P3), M-O2 (P4) 已验证两侧各 1；
// 这里再验证相向汇流场景：S1-O1 与 S2-O2 若共用一条边也只能过 1
const crossNet = {
  nodes: ['S1', 'S2', 'M', 'O'],
  pipes: [
    { id: 'P1', from: 'S1', to: 'M' },
    { id: 'P2', from: 'M', to: 'O' },
  ],
  valvedPipes: [
    { id: 'V1', from: 'S2', to: 'M', open: true },
  ],
};
const c9 = solver.verifyCapacity(crossNet, {
  supplyCaps: { S1: 1, S2: 1 },
  outletDemands: { O: 2 },
});
check('两源经汇集点 M 再过单管 P2：总分配 1（P2 双向合计容量 1）', c9.totalAllocated === 1 && c9.totalGap === 1);

console.log('核验：纯函数不修改输入：');
const beforeCap = JSON.stringify(network);
solver.verifyCapacity(network, { supplyCaps: { S1: 2, S2: 1 }, outletDemands: { B: 1, C: 1 } });
check('核验后输入网络未变化', JSON.stringify(network) === beforeCap);

console.log('核验：输入校验：');
const cE1 = solver.verifyCapacity(network, { supplyCaps: {}, outletDemands: { B: 1 } });
check('缺少供水点时报错', cE1.status === 'invalid');
const cE2 = solver.verifyCapacity(network, { supplyCaps: { S1: 1 }, outletDemands: {} });
check('缺少出口时报错', cE2.status === 'invalid');
const cE3 = solver.verifyCapacity(network, { supplyCaps: { NOPE: 1 }, outletDemands: { B: 1 } });
check('供水点不存在时报错', cE3.status === 'invalid');
const cE4 = solver.verifyCapacity(network, { supplyCaps: { S1: 1 }, outletDemands: { NOPE: 1 } });
check('出口不存在时报错', cE4.status === 'invalid');
const cE5 = solver.verifyCapacity(network, { supplyCaps: { S1: -1 }, outletDemands: { B: 1 } });
check('负的供给上限报错', cE5.status === 'invalid');
const cE6 = solver.verifyCapacity(network, { supplyCaps: { S1: 1 }, outletDemands: { B: 1.5 } });
check('非整数需求报错', cE6.status === 'invalid');

console.log('核验：不受开启阀门 12 个上限影响：');
// 13 条并行带阀管段（全开启）：核验为多项式最大流，13 条管容量 1 的并行边最多过 13
const crMany = solver.verifyCapacity(many.network, { supplyCaps: { a: 13 }, outletDemands: { b: 13 } });
check('13 个开启阀门下仍可核验且总分配 13', crMany.status === 'ok' && crMany.totalAllocated === 13);
const crMany2 = solver.verifyCapacity(many.network, { supplyCaps: { a: 5 }, outletDemands: { b: 5 } });
check('供给上限 5 / 需求 5 时总分配 5', crMany2.totalAllocated === 5);

console.log('核验：名称数值清单解析：');
const p1 = solver.parseAssignments('市政供水S1: 2, 备用水箱S2: 1', ['市政供水S1', '备用水箱S2']);
check('逗号分隔 + 冒号空格', p1.errors.length === 0 && p1.values['市政供水S1'] === 2 && p1.values['备用水箱S2'] === 1);
const p2 = solver.parseAssignments('A:1\nB:2;C：3', ['A', 'B', 'C']);
check('换行/分号/全角冒号', p2.errors.length === 0 && p2.values.A === 1 && p2.values.B === 2 && p2.values.C === 3);
const p3 = solver.parseAssignments('A, B', ['A', 'B']);
check('只写名称按 1 计', p3.errors.length === 0 && p3.values.A === 1 && p3.values.B === 1);
const p4 = solver.parseAssignments('A:-1, B:x', ['A', 'B']);
check('负数与非数字被拒绝', p4.errors.length === 2 && p4.values.A === undefined);
const p5 = solver.parseAssignments('A:1, C:2', ['A', 'B']);
check('未知名称被拒绝', p5.errors.length === 1 && p5.values.A === 1);
const p6 = solver.parseAssignments('A:1, A:2', ['A']);
check('重复名称被拒绝', p6.errors.length === 1);
const p7 = solver.parseAssignments('', ['A']);
check('空内容报错', p7.errors.length >= 1);
const p8 = solver.parseAssignments('A:0', ['A']);
check('零是非负整数', p8.errors.length === 0 && p8.values.A === 0);

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
