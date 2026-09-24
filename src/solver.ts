/**
 * 水路检修隔离求解器（纯函数，不修改输入）。
 *
 * 模型：管网为无向图。节点通过「无阀管段」与「带阀管段」相连。
 * 关闭一个阀门等价于从图中移除该带阀管段。
 * 目标：在「当前开启」的阀门中寻找关阀组合，使得
 *   1. 漏点与所有供水点断开；
 *   2. 每个保供出口仍能连通至少一个供水点。
 * 优选规则：关阀数最少；同数时按阀门编号排序后的列表取字典序最小。
 */

export interface Pipe {
  id: string;
  from: string;
  to: string;
}

export interface ValvedPipe extends Pipe {
  open: boolean;
}

export interface Network {
  nodes: string[];
  /** 无阀管段 */
  pipes: Pipe[];
  /** 带阀管段，阀门编号 id 全网唯一 */
  valvedPipes: ValvedPipe[];
}

export interface Query {
  /** 供水点节点 */
  supplies: string[];
  /** 漏点节点 */
  leak: string;
  /** 必须不断水的出口节点 */
  outlets: string[];
}

export interface OutletStatus {
  outlet: string;
  connected: boolean;
  /** 该出口当前能连通的供水点 */
  reachableSupplies: string[];
}

export interface Solution {
  /** 需要关闭的阀门编号（升序） */
  closed: string[];
  leakIsolated: boolean;
  outletStatus: OutletStatus[];
}

export interface SolveOk {
  status: 'ok';
  openValveCount: number;
  minClosed: number;
  /** 全部最优（关阀数最少）方案，按字典序排列 */
  solutions: Solution[];
  /** 最优方案总数超过展示上限时为 true */
  truncated: boolean;
}

export interface SolveNoSolution {
  status: 'no-solution';
  openValveCount: number;
  reason: string;
}

export interface SolveInvalid {
  status: 'invalid';
  errors: string[];
}

export type SolveResult = SolveOk | SolveNoSolution | SolveInvalid;

/** 一条参与韧性评估的管段（无阀管段或当前开启的带阀管段）。 */
export interface ActiveEdge {
  id: string;
  from: string;
  to: string;
}

/** 可按管段失效评估的出口。 */
export interface ResilienceRow {
  outlet: string;
  assessable: true;
  /** 使其失去全部供水至少需失效的不同管段数；当前已断水时为 0 */
  minFailures: number;
  /** 当前是否已断水（在当前阀门开闭状态下无任何供水点可达） */
  alreadyCut: boolean;
  /** 一组达到 minFailures 的管段编号（升序）；已断水时为空清单 */
  witnessPipes: string[];
}

/** 出口与供水点同名，无法按管段失效评估。 */
export interface ResilienceUnassessableRow {
  outlet: string;
  assessable: false;
  reason: string;
}

export type ResilienceResultRow = ResilienceRow | ResilienceUnassessableRow;

export interface ResilienceOk {
  status: 'ok';
  /** 参与评估的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 按所需失效数升序（无法评估的排在最后） */
  rows: ResilienceResultRow[];
}

export interface ResilienceInvalid {
  status: 'invalid';
  errors: string[];
}

export type ResilienceResult = ResilienceOk | ResilienceInvalid;

/* ---------------- 供水能力核验 ---------------- */

/** 供水能力核验的输入：各供水点供给上限与各出口需求量（均为非负整数）。 */
export interface CapacityQuery {
  /** 供水点 → 供给上限 */
  supplyCaps: Record<string, number>;
  /** 保供出口 → 需求量 */
  outletDemands: Record<string, number>;
}

/** 单个出口的获配结果。 */
export interface CapacityOutletRow {
  outlet: string;
  /** 申报需求量 */
  demand: number;
  /** 最大分配下实际获配量 */
  allocated: number;
  /** 缺口 = demand - allocated */
  gap: number;
  /** 当前阀门状态下是否与任一供水点连通（不连通时获配必为 0） */
  reachable: boolean;
}

/** 最小割中的一类限制项：供给上限 / 连通管段 / 出口需求。 */
export interface CapacityCutGroup {
  kind: 'supply' | 'pipe' | 'outlet';
  /** 供给上限：供水点名称；管段：管段编号；出口需求：出口名称（均升序） */
  items: string[];
  /** 该组容量合计（供给上限与出口需求按申报值，管段每条计 1） */
  capacity: number;
}

export interface CapacityOk {
  status: 'ok';
  /** 参与核验的连通管段数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 各供水点供给上限合计 */
  totalSupplyCap: number;
  /** 各出口需求合计 */
  totalDemand: number;
  /** 总供给最大分配量（= 多源多汇最大流） */
  totalAllocated: number;
  /** 总缺口 = totalDemand - totalAllocated */
  totalGap: number;
  /** 各出口获配明细，按出口填写顺序 */
  rows: CapacityOutletRow[];
  /**
   * 一组限制总供给的最小割（容量 = totalAllocated），按供给上限 / 管段 / 出口需求分组；
   * 割中容量为 0 的供给上限或出口需求不列入。
   */
  cutGroups: CapacityCutGroup[];
  /** 最小割容量合计（= totalAllocated） */
  cutCapacity: number;
}

export interface CapacityInvalid {
  status: 'invalid';
  errors: string[];
}

export type CapacityResult = CapacityOk | CapacityInvalid;

/** 「名称:数值」清单解析时单个数值的上限（防止误填超大数导致结果失真）。 */
export const MAX_ASSIGNMENT_VALUE = 1_000_000_000;

/** 参与组合的开启阀门数量上限 */
export const MAX_OPEN_VALVES = 12;
/** 收集的最优方案数上限（防止结果爆炸） */
export const MAX_SOLUTIONS = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'string' && x.length > 0)) return null;
  return v as string[];
}

/** 解析并校验拓扑 JSON，返回网络或错误列表。 */
export function parseNetwork(raw: unknown): { network?: Network; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { errors: ['拓扑 JSON 必须是一个对象，包含 nodes / pipes / valvedPipes 三个字段。'] };
  }

  const nodes = asStringArray(raw.nodes);
  if (!nodes || nodes.length === 0) {
    errors.push('nodes 必须是非空字符串数组。');
  }
  const nodeSet = new Set(nodes ?? []);
  if (nodes && nodeSet.size !== nodes.length) {
    errors.push('nodes 中存在重复节点。');
  }

  const parsePipes = (v: unknown, field: string, requireOpen: boolean): (Pipe[] | ValvedPipe[] | null) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      errors.push(`${field} 必须是数组。`);
      return null;
    }
    const out: (Pipe | ValvedPipe)[] = [];
    for (let i = 0; i < v.length; i++) {
      const p = v[i];
      if (!isRecord(p) || typeof p.id !== 'string' || !p.id ||
          typeof p.from !== 'string' || !p.from ||
          typeof p.to !== 'string' || !p.to) {
        errors.push(`${field}[${i}] 必须包含非空字符串字段 id / from / to。`);
        continue;
      }
      if (requireOpen && typeof p.open !== 'boolean') {
        errors.push(`${field}[${i}]（${p.id}）缺少布尔字段 open。`);
        continue;
      }
      out.push(
        requireOpen
          ? { id: p.id, from: p.from, to: p.to, open: p.open as boolean }
          : { id: p.id, from: p.from, to: p.to }
      );
    }
    return out;
  };

  const pipes = parsePipes(raw.pipes, 'pipes', false) as Pipe[] | null;
  const valvedPipes = parsePipes(raw.valvedPipes, 'valvedPipes', true) as ValvedPipe[] | null;

  // 阀门编号唯一性校验（阀门编号在带阀管段间必须唯一）
  if (valvedPipes) {
    const seen = new Set<string>();
    for (const vp of valvedPipes) {
      if (seen.has(vp.id)) errors.push(`阀门编号「${vp.id}」重复，阀门编号必须唯一。`);
      seen.add(vp.id);
    }
  }
  // 无管段编号也不允许（无阀管段与带阀管段之间也不允许重号，便于结果指代）
  if (pipes && valvedPipes) {
    const valvedIds = new Set(valvedPipes.map((p) => p.id));
    const pipeSeen = new Set<string>();
    for (const p of pipes) {
      if (valvedIds.has(p.id)) errors.push(`管段编号「${p.id}」同时出现在 pipes 与 valvedPipes 中。`);
      if (pipeSeen.has(p.id)) errors.push(`无阀管段编号「${p.id}」重复。`);
      pipeSeen.add(p.id);
    }
  }
  // 端点必须已声明
  if (nodes) {
    for (const p of [...(pipes ?? []), ...(valvedPipes ?? [])]) {
      if (!nodeSet.has(p.from)) errors.push(`管段「${p.id}」的起点「${p.from}」未在 nodes 中声明。`);
      if (!nodeSet.has(p.to)) errors.push(`管段「${p.id}」的终点「${p.to}」未在 nodes 中声明。`);
    }
  }

  if (errors.length > 0 || !nodes || !pipes || !valvedPipes) {
    return { errors: errors.length > 0 ? errors : ['拓扑解析失败。'] };
  }
  return { network: { nodes, pipes, valvedPipes }, errors: [] };
}

/** 校验查询条件（供水点 / 漏点 / 保供出口）。 */
export function validateQuery(network: Network, query: Query): string[] {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (!query.leak) {
    errors.push('必须指定漏点。');
  } else if (!nodeSet.has(query.leak)) {
    errors.push(`漏点「${query.leak}」不在节点列表中。`);
  }
  if (query.leak && query.supplies.includes(query.leak)) {
    errors.push(`漏点「${query.leak}」不能同时是供水点。`);
  }
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }
  const openCount = network.valvedPipes.filter((v) => v.open).length;
  if (openCount > MAX_OPEN_VALVES) {
    errors.push(
      `当前开启的阀门有 ${openCount} 个，超过上限 ${MAX_OPEN_VALVES} 个；` +
      '请先在输入中将部分阀门标记为关闭（"open": false）后再求解。'
    );
  }
  return errors;
}

/**
 * 解析「名称:数值」清单（供水能力核验的供给上限 / 需求量填写格式）。
 * - 条目之间用逗号、分号或换行分隔；不含冒号的条目内也可用空白分隔多个名称；
 * - 每个条目为「名称:数值」（冒号可用半角 : 或全角 ：，冒号两侧空格允许），数值须为非负整数；
 * - 只写名称、不写数值时按 1 计；
 * - 名称必须出现在 allowedNames 中，且不可重复。
 */
export function parseAssignments(
  text: string,
  allowedNames: string[]
): { values: Record<string, number>; errors: string[] } {
  const errors: string[] = [];
  const values: Record<string, number> = {};
  const allowed = new Set(allowedNames);
  const trimmed = text.trim();
  if (!trimmed) {
    return { values, errors: ['内容为空：请按「名称:数值」填写，多个用逗号或换行分隔。'] };
  }
  // 先按逗号 / 分号 / 换行拆条目；不含冒号的条目再按空白拆，兼容只写名称的写法
  const rawEntries = trimmed
    .split(/[,，;；\r\n]+/u)
    .flatMap((part) => {
      const t = part.trim();
      if (!t) return [];
      if (/[:：]/u.test(t)) return [t];
      return t.split(/\s+/u).filter((s) => s.length > 0);
    });
  for (const entry of rawEntries) {
    const sep = entry.search(/[:：]/u);
    const name = (sep >= 0 ? entry.slice(0, sep) : entry).trim();
    const numText = sep >= 0 ? entry.slice(sep + 1).trim() : '';
    if (!name) {
      errors.push(`条目「${entry}」缺少名称。`);
      continue;
    }
    if (!allowed.has(name)) {
      errors.push(`条目「${entry}」的名称「${name}」不在可填写的节点列表中。`);
      continue;
    }
    if (values[name] !== undefined) {
      errors.push(`「${name}」重复填写。`);
      continue;
    }
    if (sep >= 0 && !/^\d+$/u.test(numText)) {
      errors.push(`「${name}」的数值「${numText}」不是非负整数。`);
      continue;
    }
    const value = sep >= 0 ? Number(numText) : 1;
    if (value > MAX_ASSIGNMENT_VALUE) {
      errors.push(`「${name}」的数值 ${value} 超过上限 ${MAX_ASSIGNMENT_VALUE}。`);
      continue;
    }
    values[name] = value;
  }
  return { values, errors };
}

/** 构建无向邻接表：无阀管段全部保留，带阀管段仅在开启且未被关闭时保留。 */
function buildAdjacency(network: Network, closed: Set<string>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const p of network.pipes) {
    addEdge(p.from, p.to);
    addEdge(p.to, p.from);
  }
  for (const vp of network.valvedPipes) {
    if (!vp.open || closed.has(vp.id)) continue; // 已关闭的阀门视为断开
    addEdge(vp.from, vp.to);
    addEdge(vp.to, vp.from);
  }
  return adj;
}

function bfs(adj: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** 评估某个关阀组合，返回该方案详情（不修改输入网络）。 */
export function evaluate(network: Network, query: Query, closed: string[]): Solution {
  const closedSet = new Set(closed);
  const adj = buildAdjacency(network, closedSet);
  const reachBySupply = new Map<string, Set<string>>();
  for (const s of query.supplies) {
    reachBySupply.set(s, bfs(adj, s));
  }
  const leakIsolated = query.supplies.every((s) => !reachBySupply.get(s)!.has(query.leak));
  const outletStatus: OutletStatus[] = query.outlets.map((outlet) => {
    const reachableSupplies = query.supplies.filter((s) => reachBySupply.get(s)!.has(outlet));
    return { outlet, connected: reachableSupplies.length > 0, reachableSupplies };
  });
  return { closed: [...closed].sort(), leakIsolated, outletStatus };
}

function isValid(sol: Solution): boolean {
  return sol.leakIsolated && sol.outletStatus.every((o) => o.connected);
}

/**
 * 按关阀数从小到大枚举组合；组合本身按「编号升序列表」的字典序生成，
 * 因此同一关阀数下第一个可行解即字典序最小解。
 */
export function solve(network: Network, query: Query): SolveResult {
  const queryErrors = validateQuery(network, query);
  if (queryErrors.length > 0) return { status: 'invalid', errors: queryErrors };

  const openValves = network.valvedPipes.filter((v) => v.open).map((v) => v.id).sort();
  const n = openValves.length;

  for (let k = 0; k <= n; k++) {
    const solutions: Solution[] = [];
    let truncated = false;
    // 字典序生成 k 组合
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      if (k > 0) {
        const closed = idx.map((i) => openValves[i]);
        const sol = evaluate(network, query, closed);
        if (isValid(sol)) {
          if (solutions.length < MAX_SOLUTIONS) {
            solutions.push(sol);
          } else {
            truncated = true;
          }
        }
      } else {
        const sol = evaluate(network, query, []);
        if (isValid(sol)) solutions.push(sol);
      }
      if (k === 0) break;
      // 下一个组合
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    if (solutions.length > 0) {
      return { status: 'ok', openValveCount: n, minClosed: k, solutions, truncated };
    }
  }
  return {
    status: 'no-solution',
    openValveCount: n,
    reason:
      '在全部当前开启阀门的任意关阀组合中，均无法同时满足「漏点与所有供水点断开」且「每个保供出口仍连通至少一个供水点」。' +
      '请检查拓扑、供水点与保供出口设置，或考虑增设阀门 / 旁通管段。',
  };
}

function uniquePreservingOrder(values: string[]): string[] {
  return [...new Set(values)];
}

/** 参与韧性评估的管段：无阀管段与当前开启的带阀管段均按单条计；自环对连通无意义，忽略。 */
function collectActiveEdges(network: Network): ActiveEdge[] {
  const edges: ActiveEdge[] = [];
  for (const p of network.pipes) {
    if (p.from !== p.to) edges.push({ id: p.id, from: p.from, to: p.to });
  }
  for (const vp of network.valvedPipes) {
    if (vp.open && vp.from !== vp.to) edges.push({ id: vp.id, from: vp.from, to: vp.to });
  }
  return edges;
}

/** 仅依据当前阀门开闭状态，从全部供水点出发做连通性遍历。 */
function reachableFromSupplies(
  edges: ActiveEdge[],
  indexOf: Map<string, number>,
  supplyIdx: Set<number>
): boolean[] {
  const n = indexOf.size;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    adj[u].push(v);
    adj[v].push(u);
  }
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [];
  for (const s of supplyIdx) {
    if (!seen[s]) {
      seen[s] = true;
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Dinic 最大流：节点编号为 0..n-1，另有一个超级源点 n。 */
class Dinic {
  private readonly head: number[];
  private readonly next: number[] = [];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly level: number[];
  private readonly it: number[];

  constructor(private readonly n: number) {
    this.head = new Array(n + 1).fill(-1);
    this.level = new Array(n + 1).fill(-1);
    this.it = new Array(n + 1).fill(0);
  }

  get source(): number {
    return this.n;
  }

  /** 增加一条容量为 cap 的有向弧（自动附带零容量反向弧），返回该弧的索引。 */
  addArc(u: number, v: number, cap: number): number {
    this.next.push(this.head[u]);
    this.to.push(v);
    this.cap.push(cap);
    this.head[u] = this.next.length - 1;

    this.next.push(this.head[v]);
    this.to.push(u);
    this.cap.push(0);
    this.head[v] = this.next.length - 1;
    return this.next.length - 2;
  }

  /** 无向单位容量边：两个方向各一条容量 1 的弧。 */
  addUndirectedUnit(u: number, v: number): void {
    this.addArc(u, v, 1);
    this.addArc(v, u, 1);
  }

  /**
   * 无向共享容量边：同一对弧的两个方向初始容量各为 cap，
   * 任一方向占用流量都会消耗另一方向的剩余容量，
   * 即「同一无向管段双向合计只能占用一次」。
   */
  addUndirectedShared(u: number, v: number, cap: number): number {
    this.next.push(this.head[u]);
    this.to.push(v);
    this.cap.push(cap);
    this.head[u] = this.next.length - 1;

    this.next.push(this.head[v]);
    this.to.push(u);
    this.cap.push(cap);
    this.head[v] = this.next.length - 1;
    return this.next.length - 2;
  }

  /** 查询某条弧当前的剩余容量。 */
  residual(arcIndex: number): number {
    return this.cap[arcIndex];
  }

  private bfs(s: number, t: number): boolean {
    this.level.fill(-1);
    this.level[s] = 0;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        if (this.cap[a] > 0 && this.level[this.to[a]] === -1) {
          this.level[this.to[a]] = this.level[u] + 1;
          queue.push(this.to[a]);
        }
      }
    }
    return this.level[t] !== -1;
  }

  private dfs(u: number, t: number, pushed: number): number {
    if (u === t || pushed === 0) return pushed;
    while (this.it[u] !== -1) {
      const a = this.it[u];
      const v = this.to[a];
      if (this.cap[a] > 0 && this.level[v] === this.level[u] + 1) {
        const flow = this.dfs(v, t, Math.min(pushed, this.cap[a]));
        if (flow > 0) {
          this.cap[a] -= flow;
          this.cap[a ^ 1] += flow;
          return flow;
        }
      }
      // 该弧无法再增广，推进当前弧指针
      this.it[u] = this.next[a];
    }
    return 0;
  }

  maxFlow(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      for (let i = 0; i < this.it.length; i++) this.it[i] = this.head[i];
      while (true) {
        const pushed = this.dfs(s, t, Infinity);
        if (pushed === 0) break;
        flow += pushed;
      }
    }
    return flow;
  }

  /**
   * 最大流后在残量网络上可到达汇点 t 的节点集合（沿残量弧反向 BFS）。
   * 该集合是「最靠近出口」的最小割：在所有等优割中隔离范围最小、
   * 不会为了切掉一个出口而把整个供水侧都划入割集，便于据此安排巡检。
   */
  sinkSideCut(t: number): boolean[] {
    const inSinkSide = new Array(this.n + 1).fill(false);
    inSinkSide[t] = true;
    const queue = [t];
    while (queue.length > 0) {
      const v = queue.shift()!;
      for (let a = this.head[v]; a !== -1; a = this.next[a]) {
        const u = this.to[a]; // a 为 v→u，其配对弧 a^1 为 u→v
        // u→v 仍有残量，则 u 可经 v 到达汇点
        if (this.cap[a ^ 1] > 0 && !inSinkSide[u]) {
          inSinkSide[u] = true;
          queue.push(u);
        }
      }
    }
    return inSinkSide;
  }

  /**
   * 最大流后在残量网络上从源点 s 可达的节点集合（沿残量弧正向 BFS）。
   * 该集合给出「最靠近供水侧」的最小割：割由「可达 → 不可达」的满载弧构成。
   */
  sourceSide(s: number): boolean[] {
    const seen = new Array(this.n + 1).fill(false);
    seen[s] = true;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        const v = this.to[a];
        if (this.cap[a] > 0 && !seen[v]) {
          seen[v] = true;
          queue.push(v);
        }
      }
    }
    return seen;
  }
}

/**
 * 保供韧性巡检：对每个保供出口，计算在当前阀门开闭状态下，使其失去全部供水
 * （与所有供水点同时断开）至少需要失效多少条不同管段，并给出一组达到该数量的
 * 管段编号。无阀管段与开启的带阀管段均按单条失效计；已关阀门不参与。
 * 多个供水点作为整体（超级源点以无穷大容量接入），环路与并行管段分别计数。
 * 结果即无向多重图（单位边容）上「供水点集合 → 出口」的最小边割，由最大流求得。
 */
export function inspectResilience(network: Network, query: Query): ResilienceResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const supplies = uniquePreservingOrder(query.supplies);
  const outlets = uniquePreservingOrder(query.outlets);
  const supplySet = new Set(supplies);

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));
  const supplyIdx = new Set(supplies.map((s) => indexOf.get(s)!));
  const reachable = reachableFromSupplies(edges, indexOf, supplyIdx);
  // 超级源点接入管容超过任意真实边割，保证不会成为瓶颈
  const infiniteCap = edges.length + 1;

  const rows: ResilienceResultRow[] = outlets.map((outlet) => {
    if (supplySet.has(outlet)) {
      return {
        outlet,
        assessable: false,
        reason: '出口与供水点同名，无法按管段失效评估。',
      };
    }
    const t = indexOf.get(outlet)!;
    if (!reachable[t]) {
      // 当前阀门开闭状态下已无任何供水点可达：无需失效任何管段
      return { outlet, assessable: true, minFailures: 0, alreadyCut: true, witnessPipes: [] };
    }

    const dinic = new Dinic(network.nodes.length);
    for (const s of supplyIdx) dinic.addArc(dinic.source, s, infiniteCap);
    for (const e of edges) {
      dinic.addUndirectedUnit(indexOf.get(e.from)!, indexOf.get(e.to)!);
    }
    const minFailures = dinic.maxFlow(dinic.source, t);
    const inSinkSide = dinic.sinkSideCut(t);

    // 跨越割线、与出口同侧的边界管段，即一组达到最小失效数的管段（最贴近出口的割）
    const witnessPipes: string[] = [];
    for (const e of edges) {
      const u = indexOf.get(e.from)!;
      const v = indexOf.get(e.to)!;
      if (inSinkSide[u] !== inSinkSide[v]) witnessPipes.push(e.id);
    }
    witnessPipes.sort();
    return { outlet, assessable: true, minFailures, alreadyCut: false, witnessPipes };
  });

  rows.sort((a, b) => {
    if (a.assessable !== b.assessable) return a.assessable ? -1 : 1;
    if (a.assessable && b.assessable && a.minFailures !== b.minFailures) {
      return a.minFailures - b.minFailures;
    }
    return a.outlet.localeCompare(b.outlet, 'zh-Hans-CN');
  });

  return { status: 'ok', activePipeCount: edges.length, rows };
}

/**
 * 供水能力核验：按当前阀门开闭状态，把管网建成多源多汇最大流模型——
 * 超级源点以各供水点「供给上限」为容量接入；每条连通管段（无阀管段与开启的
 * 带阀管段，已关阀不参与）是双向合计容量 1 的无向共享容量边，即同一无向管段
 * 双向合计只能占用一次；各出口以「需求量」为容量汇入超级汇点。
 * 最大流即总供给最大分配量，各出口获配量为其汇入汇点弧上的流量；
 * 同时给出限制总供给的一组最小割（供给上限 / 管段 / 出口需求三类）。
 * 纯函数，不修改输入网络。
 */
export function verifyCapacity(network: Network, query: CapacityQuery): CapacityResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  const supplyNames = Object.keys(query.supplyCaps);
  const outletNames = Object.keys(query.outletDemands);
  if (supplyNames.length === 0) errors.push('至少需要填写一个供水点的供给上限。');
  if (outletNames.length === 0) errors.push('至少需要填写一个保供出口的需求量。');
  for (const s of supplyNames) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  for (const o of outletNames) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }
  const checkValue = (name: string, value: unknown, label: string): void => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      errors.push(`${label}「${name}」的数值必须是非负整数。`);
    } else if (value > MAX_ASSIGNMENT_VALUE) {
      errors.push(`${label}「${name}」的数值 ${value} 超过上限 ${MAX_ASSIGNMENT_VALUE}。`);
    }
  };
  for (const s of supplyNames) checkValue(s, query.supplyCaps[s], '供水点');
  for (const o of outletNames) checkValue(o, query.outletDemands[o], '保供出口');
  if (errors.length > 0) return { status: 'invalid', errors };

  const supplies = uniquePreservingOrder(supplyNames);
  const outlets = uniquePreservingOrder(outletNames);

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));
  const supplyIdx = new Set(supplies.map((s) => indexOf.get(s)!));
  const reachable = reachableFromSupplies(edges, indexOf, supplyIdx);

  // Dinic 内部节点编号 0..n-1，另取 n 为超级源点、n+1 为超级汇点
  const nodeCount = network.nodes.length;
  const dinic = new Dinic(nodeCount + 1);
  const source = nodeCount;
  const sink = nodeCount + 1;

  const supplyArc = new Map<string, number>();
  for (const s of supplies) {
    supplyArc.set(s, dinic.addArc(source, indexOf.get(s)!, query.supplyCaps[s]));
  }
  for (const e of edges) {
    // 双向合计容量 1：同一无向管段两个方向共享一份容量
    dinic.addUndirectedShared(indexOf.get(e.from)!, indexOf.get(e.to)!, 1);
  }
  const outletArc = new Map<string, number>();
  for (const o of outlets) {
    outletArc.set(o, dinic.addArc(indexOf.get(o)!, sink, query.outletDemands[o]));
  }

  const totalAllocated = dinic.maxFlow(source, sink);

  // 各出口获配量 = 需求弧上已使用的容量
  const rows: CapacityOutletRow[] = outlets.map((outlet) => {
    const demand = query.outletDemands[outlet];
    const allocated = demand - dinic.residual(outletArc.get(outlet)!);
    return {
      outlet,
      demand,
      allocated,
      gap: demand - allocated,
      reachable: reachable[indexOf.get(outlet)!],
    };
  });

  // 最小割：残量网络中源点可达集 S，跨越 S→汇侧的满载原始弧即割项，
  // 按「供给上限 / 连通管段 / 出口需求」三类分组；容量为 0 的项不构成实际限制，不列入。
  const inSourceSide = dinic.sourceSide(source);
  const cutSupply: string[] = [];
  const cutPipe: string[] = [];
  const cutOutlet: string[] = [];
  for (const s of supplies) {
    if (query.supplyCaps[s] === 0) continue;
    if (!inSourceSide[indexOf.get(s)!] && dinic.residual(supplyArc.get(s)!) === 0) {
      cutSupply.push(s);
    }
  }
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    if (inSourceSide[u] !== inSourceSide[v]) cutPipe.push(e.id);
  }
  for (const o of outlets) {
    if (query.outletDemands[o] === 0) continue;
    if (inSourceSide[indexOf.get(o)!] && dinic.residual(outletArc.get(o)!) === 0) {
      cutOutlet.push(o);
    }
  }
  cutSupply.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  cutPipe.sort();
  cutOutlet.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  const cutGroups: CapacityCutGroup[] = [];
  if (cutSupply.length > 0) {
    cutGroups.push({
      kind: 'supply',
      items: cutSupply,
      capacity: cutSupply.reduce((sum, s) => sum + query.supplyCaps[s], 0),
    });
  }
  if (cutPipe.length > 0) {
    cutGroups.push({ kind: 'pipe', items: cutPipe, capacity: cutPipe.length });
  }
  if (cutOutlet.length > 0) {
    cutGroups.push({
      kind: 'outlet',
      items: cutOutlet,
      capacity: cutOutlet.reduce((sum, o) => sum + query.outletDemands[o], 0),
    });
  }
  const cutCapacity = cutGroups.reduce((sum, g) => sum + g.capacity, 0);

  const totalSupplyCap = supplies.reduce((sum, s) => sum + query.supplyCaps[s], 0);
  const totalDemand = outlets.reduce((sum, o) => sum + query.outletDemands[o], 0);

  return {
    status: 'ok',
    activePipeCount: edges.length,
    totalSupplyCap,
    totalDemand,
    totalAllocated,
    totalGap: totalDemand - totalAllocated,
    rows,
    cutGroups,
    cutCapacity,
  };
}
