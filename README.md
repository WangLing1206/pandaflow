# 熊猫数据流 · PandaFlow

> 把 pandas 的每一次数据处理，拆解成**看得见的每一步**。

一个纯前端的**可视化数据分析全过程演示平台**。它不调用任何现成的表格 / 图表库，而是从零实现了
pandas 的核心数据结构与统计方法，并把每个操作渲染成一串**可回放的动画帧**——
让「数据是怎样从原始状态一步步变成结论」这件事，第一次真正可见。

**在线体验：** https://wangling1206.github.io/pandaflow/

---

## 为什么做这个

学 pandas 的人常常卡在同一个地方：`df.dropna()` 敲下去，结果出来了，但**中间发生了什么**没人告诉你。
索引为什么断号？`idxmax()` 到底比较了几次？`std()` 里的 `ddof=1` 是什么？离群值被删掉时，那一行里
其他正常的数据去哪了？

PandaFlow 的回答是：把每一步都放慢、放大、演给你看。

- **逐行扫描**：找最大值时，指针会一行一行走过去，擂台上的「当前冠军」实时易主
- **逐个删除**：被删的行会先变红脉冲，然后收缩消失，下方所有行整体上移
- **索引断层**：删除后索引列的跳号被如实保留，直到 `reset_index()` 把它缝合
- **逐格生长**：`assign()` 的新列是一格一格长出来的，`fillna()` 的填补是一个一个飞进去的
- **等价代码同步高亮**：每一帧都高亮当前正在执行的那一行 pandas 代码

## 核心特性

### 1. 帧脚本引擎 —— 可任意回放、拖拽、变速

每个操作不是「直接返回结果」，而是生成一串 **Frame**。每一帧都是**完整快照**而不是增量，
因此播放器可以任意反向拖动、跳转、单步、变速，都能精确还原到那一刻的数据状态。

```
操作 run(df, cfg) → { frames: Frame[], result: DataFrame }
Frame = { phase, title, narration, duration, tone, code, table, stage, hud, final }
```

### 2. 26 个 pandas 操作，覆盖完整分析流程

| 分组 | 操作 |
| --- | --- |
| **概览** | `info` `describe` `head` `tail` |
| **清洗** | **去除最大最小值 ★** `drop_duplicates` `dropna` `fillna` `clip` |
| **变换** | `sort_values` `query` `assign` `astype` `rename` `sample` `nlargest` `drop` |
| **统计** | `agg`（mean/median/std/sum…） `value_counts` `groupby` |
| **可视化** | 直方图 柱状图 折线图 散点图 箱线图 |
| **导出** | `to_csv` + 整条管道总览 |

### 3. 旗舰演示：去除最大值与最小值

以「数学成绩」列为例，完整还原 `idxmax()` / `idxmin()` 的推理过程：

1. **明确目标** — 先看清这一列，极差高达 61 分
2. **逐行扫描** — 前 3 个值慢速单独比较（建立规则），中间批量快扫，**冠军易主的瞬间必定单独成帧**，最后 3 个值再次放慢确认
3. **擂台对抗** — 挑战者 vs 当前最大 / 当前最小，每一帧给出比较结论
4. **锁定极值** — 两个极值被标记，提示「极值从不扎堆，这就是必须完整扫描的原因」
5. **执行删除** — 目标行变红脉冲 → 收缩消失 → 下方整体上移 → 索引留下断层
6. **重置索引** — `reset_index(drop=True)` 缝合断层
7. **结果对比** — 前后 shape、mean、极差与直方图形态对照

### 4. 从零实现的 pandas 语义

`src/core/dataframe.js` 里是一个完整的轻量 DataFrame：

- 类型推断（`float64` / `object` / `bool` / `int64`）
- `describe()` 八项统计，与 pandas 输出对齐
- **`std()` 默认 `ddof=1`**（贝塞尔校正），而不是 numpy 的 `ddof=0`
- **分位数用线性插值**，与 pandas 默认一致
- `isnull()` / `dropna()` / `fillna()`（含 `ffill` / `bfill`）
- 行指纹判重（`drop_duplicates`）、`groupby().agg()`、`value_counts()`、`nlargest()`
- 逐字符 CSV 解析器：引号包裹、转义引号、分隔符猜测、前导 0 标识符保护

### 5. 自己实现的 CSV 解析与图表渲染

- **CSV/TSV/JSON 导入**：自动猜分隔符、类型推断、不齐行告警、支持拖拽与粘贴
- **图表全部手写 SVG**：直方图（分箱过程可视化）、柱状图（逐根生长）、折线图（逐点绘制 + 面积渐变）、
  散点图（点飞入 + 皮尔逊相关系数）、箱线图（五数概括 + IQR 法则 + 地毯图 + 自动离群点识别）

### 6. 为动画而生的表格渲染

所有行都是绝对定位，纵向位置用 `transform: translateY()` 表达，且每行有稳定的内部 id。
于是「行重排」只是改一个 transform，浏览器自动补间；「行消失」是退场动画；「新行出现」是入场动画。
**同一个 id 的行在整条管道里始终是同一个 DOM 节点**，跨操作也能连续地动。

## 技术栈

**零依赖、零构建**：原生 ES Modules + 手写 CSS，没有 npm 依赖，没有打包步骤。
克隆下来用任意静态服务器打开 `index.html` 即可运行。

```
index.html            入口
styles/
  main.css            设计系统（令牌 / 布局 / 组件）
  stage.css           舞台专属组件
src/
  main.js             应用装配与事件绑定
  core/
    dataframe.js      DataFrame 实现（pandas 语义）
    csv.js            CSV / TSV / JSON 解析
    datasets.js       内置数据集（含精心设计的演示剧情）
    frames.js         帧脚本模型
    utils.js          统计、格式化、缓动、DOM 工具
    ops/
      index.js        操作注册表（26 个操作 + 参数表单声明）
      outliers.js     离群值：去除极值 ★ / clip / nlargest
      clean.js        清洗：drop_duplicates / dropna / fillna
      transform.js    变换：sort / query / assign / astype / rename / sample / head / tail / drop
      stats.js        统计：agg / describe / info / value_counts / groupby
      plots.js        可视化：hist / bar / line / scatter / box
      common.js       列摘要、单位、数值校验
  ui/
    player.js         帧播放器（播放 / 暂停 / 单步 / 变速 / 拖拽）
    table.js          动画数据表（FLIP 式位移 + 进出场）
    stage.js          舞台调度器 + 各 kind 渲染器
    viz.js            SVG 可视化（点阵 / 排序 / 归约 / 图表）
    panels.js         操作库 / 管道 / 配置抽屉 / 导入 / 提示
    icons.js          线性图标集
tools/                测试与录屏脚本（Playwright，不参与部署）
```

## 本地运行

```bash
# 任意静态服务器都可以，例如：
python -m http.server 8777
# 然后打开 http://127.0.0.1:8777/index.html
```

> 必须用 HTTP 打开，不能直接双击 `index.html` —— ES Modules 在 `file://` 下会被 CORS 拦截。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `←` / `→` | 单步后退 / 前进 |
| `Home` / `End` | 跳到首帧 / 末帧 |

## 内置数据集

| 数据集 | 规模 | 设计意图 |
| --- | --- | --- |
| **期末成绩单**（默认） | 38 × 9 | 同时含 **7 处缺失值**、**2 条重复录入**、**双向外离群值**（数学 99 与 38），以及可用于分组的班级维度 —— 一个数据集就能把整条清洗流程演示完整 |
| 电商订单 | 42 × 8 | 金额列有极端离群值（12.8 万团购单 / 3 元异常单），适合演示 `clip` 与箱线图 |
| 城市气温 | 36 × 5 | 多城市气象观测，适合折线图与分组聚合 |

也可以导入自己的 CSV / TSV / JSON，或直接粘贴 CSV 文本。

## 测试

`tools/` 下有 Playwright 脚本（需要单独 `npm install`）：

```bash
cd tools
node smoke.mjs     # 26 个操作全部单独跑一遍 + 链式管道 + 旗舰演示逐帧截图
node gallery.mjs   # 为每个操作抓取代表性帧截图
node diag.mjs      # 快速诊断：页面加载与控制台错误
```

---

本项目为「数据可视化」课程作业。核心不在于调用库函数直接拿到结果，
而在于**直观呈现数据分析的全过程** —— 处理逻辑与可视化演变，每一步都清晰可见。
