# v2.5 GLM 联网搜索

v2.5 为原有结构化数据库增加一个可选来源。代理先调用智谱的网络搜索接口，再把检索返回的标题和摘要交给模型提取字段。搜索弹窗可选综合搜索、仅结构化数据库、指定数据库或仅 GLM。连接并启用后，综合搜索并行查询，结构化结果可以先展示。作品名称和类别会发送给智谱。

候选保留作品身份、已提取字段的原文与链接。对同一候选，提取出多个相异且有原文的值时，字段留空并展示这些值。引文匹配能检查字段是否出现在检索摘要里。作者身份、作品版本、来源权威性和漏检的冲突仍需通过原始页面核对。网页搜索结果可展开查看；整理失败时仍可核对检索到的网页。各来源和各版本保持为独立候选，由用户选择。

GLM 搜索来源提供文字证据和页面链接。封面继续由原结构化来源按原有许可策略获取，也可以上传相册图片。选择候选后先填草稿，保留已有评分、评论及未选择替换的封面。数据和备份沿用 v2.4 格式。历史代码保存在 Git 提交 46dc0d6c826ad71987c5058f3ec10f412900efa9。

## 智谱接口与费用

| 用途 | 当前实现 | 平台公开价格 |
|---|---|---|
| 网页检索 | 标准开放平台的 POST /api/paas/v4/web_search，默认 search_pro | ¥0.03/次 |
| 低价检索选项 | 在代理上配置 GLM_SEARCH_ENGINE 为 search_std | ¥0.01/次 |
| 字段提取 | POST /api/paas/v4/chat/completions，glm-4.7-flash | 当前官方价目表列为免费 |
| Coding Plan 搜索 | WebSearchPrime MCP，单独套餐和权限 | 本项目使用标准 REST 接口 |

旧案例的 web-search-pro Chat Completions 示例页在本次检查时返回 404。新版网络搜索接口返回 search_result。开发环境中的无密钥探针到达标准搜索与聊天接口，均返回 HTTP 401、代码 1001。Coding Plan MCP 也返回鉴权错误代码 1001。普通开放平台模型额度、搜索资源包和 Coding Plan 权限分别以账户页面为准。连接代理只检查代理配置，第一次真实搜索才能验证账户权限及实际计费。

每次未命中代理缓存的搜索至多一次检索和一次整理。代理默认每天 6 次、每月 30 次，按北京时间统计，含失败尝试。按当前公开单价，默认上限相当于 Pro 每月 ¥0.90 搜索费用，或 Std 每月 ¥0.30。六个首次 Pro 验收用例对应最多 ¥0.18 搜索费用。金额按尝试次数估算，实际账单以智谱控制台为准。确认计费规则后再开启。成功候选缓存七天，网页无候选或整理失败缓存一小时。缓存最多保存 24 个查询及对应证据。代理限流为同一时刻一个搜索、两次新搜索之间至少五秒。

[智谱网络搜索](https://docs.bigmodel.cn/cn/guide/tools/web-search) · [当前价目表](https://docs.bigmodel.cn/cn/guide/start/pricing) · [Coding Plan 搜索 MCP](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server) · [智谱控制台](https://bigmodel.cn/)

## 选择代理

| 方案 | 如何使用 | 费用与安卓访问 |
|---|---|---|
| Cloudflare Workers + Durable Objects | 仓库 proxy 目录提供配置和代码 | 个人低频使用可从 Free 方案开始。默认 workers.dev 无需购买域名，普通域名在中国大陆的访问及到智谱的出站均需实测。中国网络产品另有企业及备案条件。 |
| 腾讯云函数等国内 Serverless | 适合已具备国内云账号、符合访问和域名要求的情形 | 需要另行适配部署与持久化限额计数。费用依地域、套餐及函数 URL 流量而定，境内自定义域名按平台规则处理备案。 |
| Windows 本机代理 | 使用项目内的 Node 本机预览，同源提供搜索代理 | 无新增托管费用。仅供这台电脑上的浏览器使用，与 GitHub Pages 分别保存本地收藏。 |

[Cloudflare Workers 免费计划](https://developers.cloudflare.com/workers/platform/pricing/) · [Durable Objects 价格](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [Cloudflare 中国网络条件](https://developers.cloudflare.com/china-network/get-started/) · [腾讯云函数 URL](https://cloud.tencent.com/document/product/583/96099) · [腾讯云函数定价](https://cloud.tencent.com/document/product/583/17299)

## 在 Cloudflare 安全配置

1. 在智谱开放平台控制台确认网络搜索费用，生成标准 API Key。保存在密码管理器。
2. 在本机获取项目代码并进入 proxy 目录。安装 Node 和 npm 后，运行 **npx wrangler@4 login** 及 **npx wrangler@4 deploy**。配置默认关闭智谱调用。
3. 在终端运行 **npx wrangler@4 secret put ZHIPU_API_KEY**，按提示粘贴标准 Key。另用 Node 生成独立的代理访问口令，保存后运行 **npx wrangler@4 secret put GLM_PROXY_TOKEN**，按提示粘贴该口令。

~~~sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
~~~

4. 在 Worker 的 Variables and Secrets 确认两个项目都为 Secret。确认计费和额度后，把普通变量 GLM_ALLOW_SEARCH 改为 true 并部署该配置。若用命令重新部署仓库默认配置，需要重新打开这项开关。保持 GLM_ALLOWED_ORIGINS 指向使用该代理的应用来源，默认已填正式站点。
5. 打开应用的「我的 → 设置与数据 → GLM 联网搜索」。填 Worker 的 HTTPS 网址和代理访问口令，点击「连接并查看用量」，然后打开搜索开关。浏览器仅在当前页面会话内保留代理口令，刷新后需要重新连接。智谱 Key 始终只在服务端保存。

应用的「连接并查看用量」只读代理状态。成功连接后，选择「GLM 联网搜索」并搜一个作品，核对智谱的搜索计费明细。若 Pro 权限不可用且账户支持 Std，可将代理的 GLM_SEARCH_ENGINE 改为 search_std 后再验证；也可立即使用结构化数据库和手动添加。

## 在 Windows 本机先试

需要 Node 22.13+ 和 PowerShell 7。进入项目根目录，设置独立口令和智谱 Key，再运行预览。两个输入均在终端提示内输入。

~~~powershell
$env:GLM_PROXY_TOKEN = Read-Host '代理访问口令（43 位）' -MaskInput
$env:ZHIPU_API_KEY = Read-Host '智谱标准 API Key' -MaskInput
$env:GLM_ALLOW_SEARCH = 'true'
node server.mjs
~~~

打开 http://127.0.0.1:4173/library/，在「设置与数据」将代理网址留空，输入代理访问口令连接。费用规则与云代理相同。试用结束后按 Ctrl+C 停止，在同一个窗口执行 **Remove-Item Env:GLM_PROXY_TOKEN,Env:ZHIPU_API_KEY,Env:GLM_ALLOW_SEARCH**，或关闭窗口。代理的本地缓存和限额保存在用户目录的 .shiguang-glm。正式站的收藏保存在正式站对应的浏览器存储，建议先用空收藏试用。

## 六个用例与安卓验收

| 类别 | 作品 | 本次模拟 | 账户实测 |
|---|---|---|---|
| 书籍 | 生死疲劳 | 检索、候选、作者引文、缓存通过 | 待配置后验证 |
| 书籍 | 羊脂球 | 同上，浏览器验证字段填充 | 待配置后验证 |
| 电影 | 流浪地球2 | 检索、候选、导演引文、缓存通过 | 待配置后验证 |
| 剧集 | 漫长的季节 | 同上，使用剧集分类 | 待配置后验证 |
| 普通游戏 | 黑神话：悟空 | 检索、候选、开发者引文、缓存通过 | 待配置后验证 |
| Galgame | ATRI -My Dear Moments- | 同上，使用视觉小说分类 | 待配置后验证 |

取得代理后可运行 **node proxy/verify-live.mjs --confirm**。先设置环境变量 GLM_PROXY_URL 与单独的 GLM_PROXY_TOKEN。脚本会检查代理状态，按次输出返回的网页、候选、字段证据、冲突、两阶段耗时和用量，最多执行六次可能计费的检索。请对照原始来源逐项确认字段和版本，封面在结构化候选或手动上传流程验收。

安卓用移动数据或家庭 Wi-Fi 打开正式站并进入「检查应用更新」。连接自己的代理后，先分别搜索一部书、一部剧和一个游戏。核对候选引文，选择后检查草稿，再保存或取消。验证一次同名重复搜索是否显示代理缓存，再切换「结构化数据库」和「继续手动填写」确认备用路径。最后重新打开一条旧记录，核对评分、评论和封面。中国大陆真实手机网络访问仍待验证。
