import type { Network, Query } from './solver';

/** 示例拓扑：某展馆环状供水管网 */
export const SAMPLE_NETWORK: Network = {
  nodes: [
    '市政供水S1',
    '备用水箱S2',
    '环管N1',
    '环管N2',
    '环管N3',
    '环管N4',
    '展厅A',
    '展厅B',
    '卫生间',
    '咖啡厅',
    '设备间',
  ],
  pipes: [
    { id: 'P1', from: '展厅A', to: '环管N2' },
    { id: 'P2', from: '咖啡厅', to: '环管N3' },
    { id: 'P3', from: '设备间', to: '环管N4' },
  ],
  valvedPipes: [
    { id: 'V01', from: '市政供水S1', to: '环管N1', open: true },
    { id: 'V02', from: '备用水箱S2', to: '环管N4', open: true },
    { id: 'V03', from: '环管N1', to: '环管N2', open: true },
    { id: 'V04', from: '环管N2', to: '环管N3', open: true },
    { id: 'V05', from: '环管N3', to: '环管N4', open: true },
    { id: 'V06', from: '环管N4', to: '环管N1', open: true },
    { id: 'V07', from: '卫生间', to: '环管N3', open: true },
    { id: 'V08', from: '展厅B', to: '环管N1', open: true },
    { id: 'V09', from: '展厅B', to: '环管N4', open: false },
  ],
};

export const SAMPLE_QUERY: Query = {
  supplies: ['市政供水S1', '备用水箱S2'],
  leak: '环管N2',
  outlets: ['展厅B', '咖啡厅', '卫生间'],
};

/** 示例「供水能力核验」填写内容：供水点供给上限与各保供出口需求量 */
export const SAMPLE_SUPPLY_CAPS = '市政供水S1: 2, 备用水箱S2: 1';
export const SAMPLE_OUTLET_DEMANDS = '展厅B: 1, 咖啡厅: 1, 卫生间: 1';
