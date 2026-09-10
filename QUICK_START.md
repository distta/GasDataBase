# 快速开始

网站部署到 GitHub Pages 后，直接访问：

https://distta.github.io/GasDataBase/

访客无需启动服务器、安装 Python 或下载项目。浏览器从网站读取索引与气体文件，完成检索、绘图和下载。

## 首次部署

将当前项目提交并推送到 GitHub 仓库 main 分支，在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。工作流会生成索引、打包 _site 并发布。

以后更新 GasDataBase/ 中的文件及 catalog/config.json、catalog/metadata.json 后推送，GitHub 会自动更新网站。计算仍在集群运行，Pages 只提供现成数据和前端。

## 本地开发（可选）

```bash
python3 tools/catalog.py --serve
```

本地访问 http://127.0.0.1:8000，仅用于开发预览，不影响在线网站。
