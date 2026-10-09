/* ------------------------------------------------------------------
 * datasets.js — 内置数据集（中英双语，规格驱动）
 *  ----------------------------------------------------------------
 *  列名与单元格都可以是双语：
 *    · 列名写成 { zh, en }
 *    · 单元格写成 '中文|English'（含竖线即视为双语）
 *  构建时按当前语言 pick 一次，于是「列名」本身就是数据的一部分，
 *  操作、代码片段、解说都会自然跟着语言走，不需要额外的映射表。
 *
 *  主数据集经过精心设计：7 处缺失值、2 条重复录入、双向外离群值、
 *  可用于分组的班级维度 —— 一个数据集就能把整条流程演示完整。
 * ------------------------------------------------------------------ */

import { DataFrame } from './dataframe.js';
import { L, pick, getLang } from '../i18n/index.js';

const bi = (v, lang) => {
  if (typeof v !== 'string' || !v.includes('|')) return v;
  const [zh, en] = v.split('|');
  return lang === 'zh' ? zh : en;
};

/* ==================================================================
 * 1. 期末成绩单（默认）
 * ================================================================== */
const STUDENT = {
  id: 'student',
  label: L('期末成绩单', 'Final Grade Report'),
  hint: L('38 行 × 9 列 · 含缺失、重复与离群值', '38 × 9 · missing, duplicates and outliers'),
  title: L('高一期末成绩单', 'Grade 10 Final Report'),
  subtitle: L('两个班级 · 38 条记录 · 7 处缺失值、2 条重复录入与双向外离群值',
    'Two classes · 38 records · 7 missing cells, 2 duplicate rows and two-sided outliers'),
  cols: [
    { zh: '学号', en: 'StudentID' },
    { zh: '姓名', en: 'Name' },
    { zh: '班级', en: 'Class' },
    { zh: '性别', en: 'Gender' },
    { zh: '数学', en: 'Math' },
    { zh: '语文', en: 'Chinese' },
    { zh: '英语', en: 'English' },
    { zh: '出勤率', en: 'Attendance' },
    { zh: '作业提交数', en: 'Homework' },
  ],
  labelCol: { zh: '姓名', en: 'Name' },
  categoryCol: { zh: '班级', en: 'Class' },
  units: {
    zh: { 数学: '分', 语文: '分', 英语: '分', 出勤率: '%', 作业提交数: '次' },
    en: { Math: 'pts', Chinese: 'pts', English: 'pts', Attendance: '%', Homework: 'times' },
  },
  dict: [
    [{ zh: '学号', en: 'StudentID' }, L('学生唯一编号', 'Unique student ID')],
    [{ zh: '姓名', en: 'Name' }, L('学生姓名', 'Student name')],
    [{ zh: '班级', en: 'Class' }, L('所属班级（分组维度）', 'Class group — the natural grouping key')],
    [{ zh: '性别', en: 'Gender' }, L('男 / 女', 'M / F')],
    [{ zh: '数学', en: 'Math' }, L('数学期末成绩，满分 100', 'Math final score, out of 100')],
    [{ zh: '语文', en: 'Chinese' }, L('语文期末成绩，满分 100', 'Chinese final score, out of 100')],
    [{ zh: '英语', en: 'English' }, L('英语期末成绩，满分 100', 'English final score, out of 100')],
    [{ zh: '出勤率', en: 'Attendance' }, L('本学期出勤率', 'Attendance rate this term')],
    [{ zh: '作业提交数', en: 'Homework' }, L('按时提交作业次数（共 28 次）', 'Assignments handed in on time (of 28)')],
  ],
  rows: [
    ['20240101', '陈屿|Chen Yu', '高一(3)班|Class 3', '男|M', 99, 88, 92, 98.5, 24],
    ['20240102', '林知遥|Lin Zhiyao', '高一(5)班|Class 5', '女|F', 94, 91, 95, 99.2, 26],
    ['20240103', '苏晚|Su Wan', '高一(3)班|Class 3', '女|F', 88, 95, 90, 97.8, 25],
    ['20240104', '周子豪|Zhou Zihao', '高一(5)班|Class 5', '男|M', 38, 62, 55, 76.4, 12],
    ['20240105', '沈砚|Shen Yan', '高一(3)班|Class 3', '男|M', 85, 79, 81, 94.6, 23],
    ['20240106', '顾清和|Gu Qinghe', '高一(5)班|Class 5', '男|M', 91, 86, 88, 96.9, 24],
    ['20240107', '江予安|Jiang Yuan', '高一(3)班|Class 3', '女|F', 78, 88, 84, 95.3, 22],
    ['20240108', '许南风|Xu Nanfeng', '高一(5)班|Class 5', '男|M', 82, 74, 79, 93.1, 21],
    ['20240109', '温子沐|Wen Zimu', '高一(3)班|Class 3', '女|F', 76, 90, 86, 97.2, 25],
    ['20240110', '白露|Bai Lu', '高一(5)班|Class 5', '女|F', 89, 93, 91, 98.0, 26],
    ['20240111', '谢云舟|Xie Yunzhou', '高一(3)班|Class 3', '男|M', 92, 80, 85, 95.7, 22],
    ['20240112', '韩星野|Han Xingye', '高一(5)班|Class 5', '男|M', 73, 70, null, 90.5, 19],
    ['20240113', '叶栀|Ye Zhi', '高一(3)班|Class 3', '女|F', 87, 89, 88, null, 24],
    ['20240107', '江予安|Jiang Yuan', '高一(3)班|Class 3', '女|F', 78, 88, 84, 95.3, 22],
    ['20240114', '裴听澜|Pei Tinglan', '高一(5)班|Class 5', '女|F', 80, 84, 82, 94.8, 23],
    ['20240115', '陆时|Lu Shi', '高一(3)班|Class 3', '男|M', 84, 76, 78, 92.6, 20],
    ['20240116', '方见山|Fang Jianshan', '高一(5)班|Class 5', '男|M', 68, 72, 70, null, 18],
    ['20240117', '唐幼微|Tang Youwei', '高一(3)班|Class 3', '女|F', 90, 92, 93, 98.3, 26],
    ['20240118', '罗砚辞|Luo Yanci', '高一(5)班|Class 5', '男|M', 86, 82, 84, 95.1, 23],
    ['20240119', '秦昭|Qin Zhao', '高一(3)班|Class 3', '男|M', 79, 85, null, 94.2, 22],
    ['20240120', '孟浮生|Meng Fusheng', '高一(5)班|Class 5', '女|F', 83, 87, 85, 96.1, 24],
    ['20240121', '邵青梧|Shao Qingwu', '高一(3)班|Class 3', '女|F', 75, 91, 89, 96.8, null],
    ['20240122', '傅司白|Fu Sibai', '高一(5)班|Class 5', '男|M', 88, 78, 80, 93.4, 21],
    ['20240123', '崔照野|Cui Zhaoye', '高一(3)班|Class 3', '男|M', 81, 83, 87, 95.0, 22],
    ['20240124', '卫疏桐|Wei Shutong', '高一(5)班|Class 5', '女|F', 93, 94, 90, 98.7, 27],
    ['20240125', '阮听雪|Ruan Tingxue', '高一(3)班|Class 3', '女|F', 77, 86, 83, 95.6, 23],
    ['20240126', '曹知许|Cao Zhixu', '高一(5)班|Class 5', '男|M', null, 69, 74, 89.8, 19],
    ['20240127', '严既明|Yan Jiming', '高一(3)班|Class 3', '男|M', 87, 81, 79, 94.0, 22],
    ['20240128', '蒋昭雪|Jiang Zhaoxue', '高一(5)班|Class 5', '女|F', 85, 92, 91, 97.5, 25],
    ['20240129', '洪知远|Hong Zhiyuan', '高一(3)班|Class 3', '男|M', 66, 75, 72, 90.2, null],
    ['20240130', '龚南枝|Gong Nanzhi', '高一(5)班|Class 5', '女|F', 89, 88, 86, 96.6, 24],
    ['20240131', '楚云舒|Chu Yunshu', '高一(3)班|Class 3', '女|F', 82, 87, 84, 95.4, 23],
    ['20240132', '姜雪见|Jiang Xuejian', '高一(5)班|Class 5', '女|F', 78, 83, 81, 94.5, 22],
    ['20240133', '尹初霁|Yin Chuji', '高一(3)班|Class 3', '男|M', 91, 79, 82, 93.8, 21],
    ['20240134', '邓怀瑾|Deng Huaijin', '高一(5)班|Class 5', '男|M', 74, 71, 77, 91.3, 19],
    ['20240135', '常叙白|Chang Xubai', '高一(3)班|Class 3', '男|M', 80, 84, 85, 95.9, 23],
    ['20240136', '樊星回|Fan Xinghui', '高一(5)班|Class 5', '女|F', 86, 90, 89, 97.1, 24],
    ['20240122', '傅司白|Fu Sibai', '高一(5)班|Class 5', '男|M', 88, 78, 80, 93.4, 21],
  ],
  source: L('内置数据集 · 期末成绩单', 'Built-in · Final grade report'),
};

/* ==================================================================
 * 2. 电商订单流水
 * ================================================================== */
const ORDER = {
  id: 'orders',
  label: L('电商订单', 'E-commerce Orders'),
  hint: L('42 行 × 8 列 · 金额离群值明显', '42 × 8 · strong amount outliers'),
  title: L('电商订单流水', 'E-commerce Orders'),
  subtitle: L('42 条订单 · 含极端金额与缺失折扣率', '42 orders · extreme amounts and missing discounts'),
  cols: [
    { zh: '订单号', en: 'OrderID' },
    { zh: '城市', en: 'City' },
    { zh: '品类', en: 'Category' },
    { zh: '数量', en: 'Qty' },
    { zh: '单价', en: 'Price' },
    { zh: '金额', en: 'Amount' },
    { zh: '折扣率', en: 'Discount' },
    { zh: '状态', en: 'Status' },
  ],
  labelCol: { zh: '订单号', en: 'OrderID' },
  categoryCol: { zh: '品类', en: 'Category' },
  units: {
    zh: { 金额: '元', 单价: '元', 折扣率: '%', 数量: '件' },
    en: { Amount: 'CNY', Price: 'CNY', Discount: '%', Qty: 'pcs' },
  },
  dict: [
    [{ zh: '订单号', en: 'OrderID' }, L('订单唯一编号', 'Unique order id')],
    [{ zh: '城市', en: 'City' }, L('收货城市', 'Delivery city')],
    [{ zh: '品类', en: 'Category' }, L('商品品类（分组维度）', 'Product category — grouping key')],
    [{ zh: '金额', en: 'Amount' }, L('订单成交金额', 'Order amount')],
    [{ zh: '折扣率', en: 'Discount' }, L('折扣百分比，部分缺失', 'Discount %, partially missing')],
    [{ zh: '状态', en: 'Status' }, L('已完成 / 已退款', 'Completed / Refunded')],
  ],
  gen: () => {
    const cities = ['北京|Beijing', '上海|Shanghai', '广州|Guangzhou', '深圳|Shenzhen', '杭州|Hangzhou', '成都|Chengdu'];
    const cats = ['数码|Digital', '家居|Home', '服饰|Apparel', '美妆|Beauty', '食品|Food'];
    const rows = [];
    let s = 20261009 >>> 0;
    const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 42; i++) {
      const qty = 1 + Math.floor(r() * 6);
      const price = Math.round((20 + r() * 980) * 100) / 100;
      let amount = Math.round(qty * price * 100) / 100;
      if (i === 7) amount = 128000;
      if (i === 25) amount = 3;
      const discount = r() < 0.18 ? null : Math.round(r() * 40 + 5);
      rows.push([
        `ORD${2026001 + i}`,
        cities[Math.floor(r() * cities.length)],
        cats[Math.floor(r() * cats.length)],
        qty, price, amount, discount,
        r() < 0.12 ? '已退款|Refunded' : '已完成|Completed',
      ]);
    }
    return rows;
  },
  source: L('内置数据集 · 电商订单流水', 'Built-in · E-commerce orders'),
};

/* ==================================================================
 * 3. 城市气象观测
 * ================================================================== */
const WEATHER = {
  id: 'weather',
  label: L('城市气温', 'City Weather'),
  hint: L('36 行 × 5 列 · 时间序列', '36 × 5 · time series'),
  title: L('城市气象观测', 'City Weather Observations'),
  subtitle: L('36 条观测记录 · 适合时间序列与分组演示', '36 observations · good for time series and grouping'),
  cols: [
    { zh: '日期', en: 'Date' },
    { zh: '城市', en: 'City' },
    { zh: '气温', en: 'Temp' },
    { zh: '湿度', en: 'Humidity' },
    { zh: '风速', en: 'Wind' },
  ],
  labelCol: { zh: '城市', en: 'City' },
  categoryCol: { zh: '城市', en: 'City' },
  units: { zh: { 气温: '℃', 湿度: '%', 风速: 'm/s' }, en: { Temp: '°C', Humidity: '%', Wind: 'm/s' } },
  dict: [
    [{ zh: '日期', en: 'Date' }, L('观测日期', 'Observation date')],
    [{ zh: '城市', en: 'City' }, L('观测城市（分组维度）', 'City — grouping key')],
    [{ zh: '气温', en: 'Temp' }, L('日均气温', 'Daily mean temperature')],
    [{ zh: '湿度', en: 'Humidity' }, L('相对湿度', 'Relative humidity')],
    [{ zh: '风速', en: 'Wind' }, L('平均风速', 'Mean wind speed')],
  ],
  gen: () => {
    const cities = ['哈尔滨|Harbin', '北京|Beijing', '上海|Shanghai', '广州|Guangzhou', '昆明|Kunming'];
    const base = [4, 13, 18, 24, 17];
    let s = 7 >>> 0;
    const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const rows = [];
    for (let m = 1; m <= 6; m++) {
      for (let d = 1; d <= 6; d++) {
        const i = rows.length;
        const ci = i % cities.length;
        const t = base[ci] + (r() * 8 - 4) + Math.sin(i / 6) * 3;
        rows.push([
          `03-${String(m).padStart(2, '0')}${d}`,
          cities[ci],
          Math.round(t * 10) / 10,
          Math.round((40 + r() * 50) * 10) / 10,
          Math.round(r() * 12 * 10) / 10,
        ]);
      }
    }
    return rows;
  },
  source: L('内置数据集 · 城市气象观测', 'Built-in · City weather observations'),
};

/* ==================================================================
 * 4. 区域负责人（merge / join 演示用的查找表）
 * ================================================================== */
const REGION = {
  id: 'region',
  label: L('区域负责人', 'Regional Managers'),
  hint: L('6 行 × 3 列 · 用于 merge 演示', '6 × 3 · for the merge demo'),
  title: L('区域负责人表', 'Regional Managers'),
  subtitle: L('城市 → 负责人 的映射表，用于演示 merge', 'A city → manager lookup table, used to demo merge'),
  cols: [
    { zh: '城市', en: 'City' },
    { zh: '负责人', en: 'Manager' },
    { zh: '区域', en: 'Region' },
  ],
  labelCol: { zh: '城市', en: 'City' },
  categoryCol: { zh: '区域', en: 'Region' },
  units: { zh: {}, en: {} },
  dict: [
    [{ zh: '城市', en: 'City' }, L('连接键', 'Join key')],
    [{ zh: '负责人', en: 'Manager' }, L('区域负责人姓名', 'Regional manager')],
    [{ zh: '区域', en: 'Region' }, L('所属大区', 'Macro region')],
  ],
  rows: [
    ['北京|Beijing', '赵一鸣|Zhao Yiming', '华北|North'],
    ['上海|Shanghai', '钱思远|Qian Siyuan', '华东|East'],
    ['广州|Guangzhou', '孙立诚|Sun Licheng', '华南|South'],
    ['深圳|Shenzhen', '孙立诚|Sun Licheng', '华南|South'],
    ['杭州|Hangzhou', '钱思远|Qian Siyuan', '华东|East'],
    ['成都|Chengdu', '李承宇|Li Chengyu', '西南|Southwest'],
  ],
  source: L('内置数据集 · 区域负责人', 'Built-in · Regional managers'),
};

/* ================================================================== */

export const SPECS = [STUDENT, ORDER, WEATHER, REGION];

export const BUILTIN_DATASETS = SPECS.map((s) => ({
  id: s.id,
  label: s.label,
  hint: s.hint,
  make: (lang = getLang()) => buildSpec(s, lang),
}));

export function buildSpec(spec, lang = getLang()) {
  const columns = spec.cols.map((c) => pick(c, lang));
  const raw = spec.gen ? spec.gen(lang) : spec.rows;
  const rows = raw.map((r) => r.map((v) => bi(v, lang)));
  const units = spec.units?.[lang] || {};
  return new DataFrame(columns, rows, {
    name: spec.id,
    source: pick(spec.source, lang),
    meta: {
      title: pick(spec.title, lang),
      subtitle: pick(spec.subtitle, lang),
      dict: spec.dict
        ? Object.fromEntries(spec.dict.map(([c, d]) => [pick(c, lang), pick(d, lang)]))
        : null,
      unit: units,
      labelCol: spec.labelCol ? pick(spec.labelCol, lang) : null,
      categoryCol: spec.categoryCol ? pick(spec.categoryCol, lang) : null,
      specId: spec.id,
      builtin: true,
    },
  });
}

export function makeDefaultDataset(lang = getLang()) { return buildSpec(STUDENT, lang); }

export function specById(id) { return SPECS.find((s) => s.id === id) || null; }

export function makeSpec(id, lang = getLang()) {
  const s = specById(id);
  return s ? buildSpec(s, lang) : null;
}
