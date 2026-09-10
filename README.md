# GasDataBase

气体文件数据库与静态检索、比较和绘图页面。

网站：https://distta.github.io/GasDataBase/

## 部署

在仓库 Settings → Pages → Source 中选择 GitHub Actions。推送 main 后自动构建并发布网站，访客无需启动服务器。

## 目录

- `GasDataBase/`：按稀有气体、组分数量和具体体系组织的正式 .gas 文件，例如 `Ar+X/Ar_CO2/`。
- `assets/`、`index.html`：页面、样式、解析与绘图逻辑。
- `catalog/`：收录配置、索引与集中来源记录。
- `tools/`：目录生成和静态网站打包工具。
- `tests/`：发布数据解析和页面契约检查。
- `Doc/`：维护与参数说明。

计算任务、历史库存和完整日志不在发布仓库中；来源记录中的 runs 路径指向计算工作区。

本地预览（可选）：`python3 tools/catalog.py --serve`。

[维护说明](Doc/简易数据库维护说明.md) · [参数说明](Doc/气体参数展示约定.md)

本地计算工作区中的 `original/`、`simulation/`、`runs/`、`reports/` 及入库、盘点工具保留在本机，由 `.gitignore` 排除。远程只维护网页、正式数据库和发布所需代码。
