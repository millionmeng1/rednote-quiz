# 疲惫类型自测

一个纯静态的在线心理测评页。18 道题、6 个维度，输出一张六维疲劳分布图和一份结果解读，支持把结果存成长图、复制分享链接给朋友。

## 技术构成

- **前端**：原生 HTML / CSS / JavaScript，无框架、无构建步骤。雷达图是手写 SVG，结果长图用 html2canvas 渲染。
- **后端**：Supabase（PostgreSQL + PostgREST）。前端不引入 supabase-js，直接 `fetch` 调用数据库函数。
- **部署**：GitHub Pages，纯静态托管。

## 目录

```
index.html        测评主页面（密码入口 → 答题 → 结果 → 分享）
admin.html        密码发放后台（批量生成、重置、备份、统计）
supa.js           后端调用层：把前端请求路由到 Supabase 数据库函数
config.js         Supabase 项目地址与 anon key
data.js           题目与结果文案
quiz.js           计分与图表绘制
poster.js         结果长图生成
vendor/           html2canvas
admin/            仅用于让 /admin/ 这个短网址可用的跳转页
```

## 数据库

数据库由一组 SQL 函数对外提供接口，所有数据表都开启了行级安全（RLS）且不对外开放任何直接读写权限 —— 前端只能调用函数，「一个密码只能完整测试一次」的判定也在数据库内部完成。

## 说明

本项目为个人运营的付费测评工具，题目与结果文案为原创内容。如需引用请先联系作者。
