# MPGD 常用配气与数据库缺项调研

调研日期：2026-09-11。范围为 GEM、Micromegas、THGEM 及其混合结构的代表性运行配气，并单列光子探测、光学读出与 X 射线偏振测量的专用配气。这里的“代表性”以实验实际采用或明确研究为依据，不表示所有 MPGD 都适用，也不是对全部文献的穷尽统计。

结论：优先补齐三元配气 Ar/CF4/iC4H10、Ar/CO2/iC4H10、Ne/CO2/N2、Ar/CO2/CF4，以及已有 Ne/C2H6/CF4 体系中的 85/10/5。纯 CF4 和 COMPASS 80/10/10 常压数据仍待补齐。

## 核查口径

- 正式库 `GasDataBase/` 实际有 243 个 `.gas` 文件，与 `catalog/gases.json` 一致；按组分及比例去重后为 139 种配方，31 个体系（包含 12 种纯气）。不同温压不重复计为新配方。
- 按组分名称和数值比例核查正式库，而非只看目录或文件名。调研时检查过的旧库存现已删除，以下正式库缺项仍需通过新计算或重新获取并核验来源补齐。
- “缺体系”指正式库完全没有该组分组合；“缺比例”指体系已有但精确比例不存在；“缺工况”单独比较温度和压力。
- 除 ALICE 90:10:5 的相对份数外，下文比例均按所列组分顺序表示体积百分比。iC4H10 是异丁烷，DME 是二甲醚，TMA 是三甲胺。
- 本次核查不等于完成数据质量、Penning 参数或探测器增益的验证；只新增调研文档，未修改或生成气体数据。

## 优先补充的代表性配方

优先级为本次依据代表性实验覆盖面给出的数据库维护建议。

| 优先级 | 组分 | 比例 | 实验用途与来源 | 正式库状态  |
|---|---|---|---|--- |
| P1 | Ar/CF4/iC4H10 | 95/3/2 | T2K Micromegas-TPC 的标准配气。[探测器论文](https://www.sciencedirect.com/science/article/abs/pii/S0168900211003421) | 缺体系  |
| P1 | Ar/CO2/iC4H10 | 93/5/2 | ATLAS NSW Micromegas 三元工作气。[ATLAS 探测器文档](https://cds.cern.ch/record/2859916/files/2305.16623.pdf) | 缺体系；已有 Ar/CO2=93/7 不等价  |
| P1 | Ne/CO2/N2 | 90:10:5 相对份数 | ALICE GEM-TPC 基准配气。[TPC 升级 TDR](https://indico.ifj.edu.pl/event/115/contributions/537/attachments/426/484/TPC_TDR_2014.pdf) | 缺体系  |
| P1 | Ar/CO2/CF4 | 45/15/40 | LHCb M1 三层 GEM 历史运行配气、快速 GEM 参考配方。[LHCb 运行报告](https://cds.cern.ch/record/1495070/files/LHCb-PROC-2012-060.pdf) | 缺体系  |
| P1 | Ne/C2H6/CF4 | 85/10/5 | COMPASS 强子束 Micromegas 配气。[强子束装置论文](https://cds.cern.ch/record/1950827/files/nima779-69.pdf) | 缺比例；已有 80/10/10 等  |
| P2 | Ar/CH4 | 50/50 | COMPASS RICH-1 的 THGEM+Micromegas 光子探测器。[探测器论文](https://arxiv.org/pdf/1812.06971) | 缺比例  |
| P2 | He/CF4 | 60/40 | CYGNO 光学读出气体探测器的代表性配气。[合作组官网](https://web.infn.it/cygnus/) | 缺体系  |
| P2 | DME | 100 | GEM-GPD X 射线偏振探测；IXPE 使用纯 DME。[IXPE GPD 设计论文](https://search.asi.it/server/api/core/bitstreams/cb49eb29-9de4-422b-80ed-48849539c1a5/content) | 缺纯气文件  |
| P2 | CF4 | 100 | PHENIX HBD 的 CsI+GEM 光子探测器。[PHENIX 官方说明](https://www.phenix.bnl.gov/detectors/hbd.html) | 缺纯气文件  |
| P3 | He/DME | 20/80 | 历史 XIPE/GPD 方案；应与 IXPE 纯 DME 区分。[XIPE 方案论文](https://discovery.ucl.ac.uk/id/eprint/1419899/1/1309.6995v1.pdf) | 缺体系  |

ALICE 的 90:10:5 总和是 105，入库为百分比时应归一化为约 **85.714286/9.523810/4.761904**，同时保留文献的原始份数标记。不能将其写成总和 105% 的百分比配方，也不能擅自替换成 85/10/5。

## 已覆盖的常用配气与实际工况缺口

| 组分与比例 | 文献代表用途 | 当前覆盖 |
|---|---|---|
| Ar/CO2=70/30 | CMS GEM 工作气。[CMS 官方说明](https://cmsexperiment.web.cern.ch/node/1987) | 已有 293.15 K、760 Torr 文件 |
| Ar/CO2=80/20、90/10 | GEM 测试和输运/离子反馈比较。[实验论文](https://arxiv.org/abs/2106.15970) | 两者均有 293.15 K、760 Torr 文件 |
| Ar/CO2=93/7 | ATLAS NSW 原设计和二元参考配气。[长期辐照研究](https://repository.cern/records/sd8xh-4vb08) | 已有 293.15 K、760 Torr 及多个压力点；不能代替 93/5/2 |
| Ar/iC4H10=90/10 | KLOE-2 圆柱 GEM。[合作组报告](https://pos.sissa.it/180/495/pdf) | 已有 293.15 K、760 Torr 文件；这里是 Ar，不是漂移室的 He |
| Ne/C2H6/CF4=80/10/10 | COMPASS Micromegas 原有配气。[装置论文](https://wwwcompass.cern.ch/compass/publications/papers/cern-ph-ep_2007-001/compass_spec_070225.pdf) | 有配方，但正式库只覆盖 0.05–0.8 atm 的 9 个压力点，缺 1 atm |
| Ne/CO2=90/10；Ne/CF4=90/10、80/20 | ALICE GEM-TPC 气体候选比较。[原始研究](https://tpc_gas.cfnssbu.physics.sunysb.edu/tpc_gas/Papers/Ball_2014_J._Inst._9_C04025.pdf) | 均已有 293.15 K、760 Torr 文件 |

现有主要二元体系的比例范围：

- Ar/CO2：95/5、93/7、90/10、88/12、85/15、80/20、75/25、70/30、60/40。
- Ar/iC4H10：已有 99.5/0.5、99/1、98/2、97/3、96/4、95/5、93/7、90/10 等，共 16 种比例。
- Ar/CH4：99/1、95/5、90/10、85/15、80/20、75/25、70/30；因此 50/50 是明确缺项。
- Ne/C2H6/CF4：已有 12 种比例；85/12/3、85/7.5/7.5、85/3/12 均不能代替文献的 85/10/5。

## 建议的补库顺序

1. 补齐纯 CF4 与 COMPASS 80/10/10 的 1 atm 数据；旧库存已删除，需重新获取并核验来源，或重新计算。
2. 计算 P1 的五个精确配方；先以库内常用的 293.15 K、760 Torr 建立可比较基准。ALICE 配方归一化后再生成。
3. 按应用补 Ar/CH4=50/50、He/CF4=60/40、纯 DME；若重点是 X 射线 GPD，再补 He/DME=20/80。纯 DME 的应用压力应按具体文献另设，例如 IXPE 设计论文的 800 mbar 不能当作 760 Torr。
4. 补全目标应用的漂移区和放大区电场、磁场及 E–B 夹角范围；已有比例不代表已有可直接用于目标探测器的完整气体表。

纯 Ar、Ne、CO2、N2 和 iC4H10 等基础对照气也不在正式纯气目录。这是基础对照数据的扩展需求，不应与上述实验工作配方的缺项混为一类。现有 RPC 类含氟三元气的覆盖，也不能替代 GEM/Micromegas 代表性工作气的覆盖。
