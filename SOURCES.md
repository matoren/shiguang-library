# 联网资料来源与约束

## v2.2 当前策略（以下旧版说明仅作历史记录）

自动模式：**书籍：Bangumi → Open Library；电影/剧集/游戏：Bangumi → Wikidata，各尝试一次**。首源有候选即结束；错误/无匹配会显示原因并尝试一次备用。可手选来源，书籍另有 Open Library，剧集另有 TVmaze。没有后台抓取、循环重试或影视播放/网盘/磁力接口。

**Bangumi**：`POST https://api.bgm.tv/v0/search/subjects` 按作品名称查询，不需要登录、Token 或 Key。书籍type 1、影视type 2/6、游戏type 4，再区分电影/剧集。图书偏动漫，羊脂球实测空结果；影视游戏也非全量，不能保证大陆线路可用。文档标为实验性，故严格校验结构，失败不伪装无结果。

- 官方文档：https://bangumi.github.io/api/ 、https://github.com/bangumi/api/blob/master/open-api/v0.yaml
- 协议与权利：https://bgm.tv/about/copyright 。可在公开 API 范围开发应用，条目资料按 CC BY-SA；既有版权作品的权利仍归原权利人。本项目只保留必要元数据、来源与许可，不采集用户日志、评论或播放链接。API封面来自 lain.bgm.tv，缩放后用于个人收藏并保留来源说明，不宣称属于公有领域。
- 实际预检和浏览器POST均成功，无凭证跨域响应为 `Access-Control-Allow-Origin: *`；预检允许Content-Type。不能据此宣称大陆所有线路均可用。

**Wikidata**改为影视/游戏的自动境外备用，书籍可手选，CC0、无Key；作者/类型标签失败时可显示部分结果并提示缺失。Commons只在选择候选后查询明确许可；未取得许可或图片下载失败保留文字/旧封面。

**Open Library**按书名查询，不是仅ISBN；当前环境实际返回羊脂球与作者，但本次返回条目无封面。**TVmaze**只供剧集备用，可尝试原名，不把播出网络所在国当作制作国。其官方API免费、无Key、支持CORS，CC BY-SA并允许缓存图片，保留归属。https://www.tvmaze.com/api

### 请求、缓存与图片

- 来源总预算：Bangumi9秒、Wikidata12秒、Open Library/TVmaze各8秒。书籍自动模式约17秒、其他约21秒上限，包含排队、来源内请求和异步解析，可随时停止。
- 单请求默认8秒，作品实体6秒，创作者/类型名称3.5秒；同主机间隔约1秒。区分超时、HTTP错误、429、格式异常及空结果，不自动循环重试。
- 浏览器一般不暴露DNS/TLS/CORS具体原因，网络异常明确列为“网络或跨域限制”，不虚构根因。
- 封面许可3.5秒、下载6秒、整个封面阶段8秒上限；可关闭网络封面先填文字。图片仅接受明确白名单HTTPS域名，压缩为本地图片数据，备份保留署名。
- 成功候选仅本机保存7天、最多24次查询，不含评分评论，不改变收藏数据库或备份。强制联网会同时绕过持久候选缓存和会话请求缓存。缓存损坏/配额不足不妨碍搜索与保存。

### 评估后未接入

- 百度知识图谱：https://kgopen.baidu.com/ 当前可见联系入口，未取得可验证的通用作品查询接入文档与用途授权。未声称其不存在商业授权接口，仅提供百科外部搜索。
- 豆瓣：https://developers.douban.com/ 本环境不可访问，未取得当前官方作品接口文档或授权；未用历史v2、Frodo内部接口、Cookie、抓取或反爬绕过。仅提供外部搜索。
- 聚合ISBN：https://www.juhe.cn/docs/download/pdf/726 明确需Key和10/13位ISBN，不能替代书名搜索。未开通，未确认套餐/额度，未调用。
- 书格：https://api.shuge.org/ 有古籍查询文档，范围有限。本环境返回 `Access-Control-Allow-Origin: *, *`，不足以认定浏览器CORS可用，未接入。
- NeoDB：https://neodb.net/install/ 涉及上游Google/TMDb/IGDB凭证，不能据此消除上游授权与网络问题，未增加该实例依赖。
- 未申请、购买或嵌入TMDb/IGDB等需要保密的凭证；没有新增后端、付费服务或模型调用。

无可确认的大陆运营商网络出口或安卓真机；开发环境成功不代表GitHub Pages、Bangumi或其他境外接口在大陆稳定。百度/百科/豆瓣仅正常网页导航，不会自动抓取或填入。

## v2.0 历史说明（默认来源等以以上v2.2策略为准）

- Wikidata 结构化数据为 CC0；使用公开 Action API 搜索与实体读取，不需要应用密钥。文档：https://www.wikidata.org/wiki/Wikidata:Data_access 和 https://www.wikidata.org/wiki/Wikidata:Licensing 。
- MediaWiki 跨域请求明确携带 `origin=*`，请求不带凭证。文档：https://www.mediawiki.org/wiki/API:Cross-site_requests 。
- Wikimedia Commons 使用 Imageinfo 查询 URL、作者和许可；仅处理 Public domain、CC0、CC BY、CC BY-SA 明确许可的图片，保存归属与许可并说明缩放压缩。文档：https://www.mediawiki.org/wiki/API:Imageinfo 。
- Open Library 搜索和封面为可选公开图书来源。文档：https://openlibrary.org/dev/docs/api/search 与 https://openlibrary.org/dev/docs/api/covers 。实测此环境有连接不稳定情况，因此默认使用 Wikidata。
- Google Books 实测返回 429 配额错误，未作为默认来源。TMDb 需要注册密钥；IGDB 涉及访问令牌、Client Secret 和后端代理，不在公开静态前端中接入。没有注册付费服务或嵌入任何秘密密钥。
- 请求由用户点击触发，间隔至少约一秒，有限内存缓存，不后台爬取。不自动重试限流响应。只发送检索词，不发送私人记录或评分。
- 三类元数据搜索已接入。海报和游戏封面覆盖率取决于公开来源；缺图不是用临时 URL 替代本地保存的理由，仍提供手动上传。

