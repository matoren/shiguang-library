# 联网资料来源与约束

- Wikidata 结构化数据为 CC0；使用公开 Action API 搜索与实体读取，不需要应用密钥。文档：https://www.wikidata.org/wiki/Wikidata:Data_access 和 https://www.wikidata.org/wiki/Wikidata:Licensing 。
- MediaWiki 跨域请求明确携带 `origin=*`，请求不带凭证。文档：https://www.mediawiki.org/wiki/API:Cross-site_requests 。
- Wikimedia Commons 使用 Imageinfo 查询 URL、作者和许可；仅处理 Public domain、CC0、CC BY、CC BY-SA 明确许可的图片，保存归属与许可并说明缩放压缩。文档：https://www.mediawiki.org/wiki/API:Imageinfo 。
- Open Library 搜索和封面为可选公开图书来源。文档：https://openlibrary.org/dev/docs/api/search 与 https://openlibrary.org/dev/docs/api/covers 。实测此环境有连接不稳定情况，因此默认使用 Wikidata。
- Google Books 实测返回 429 配额错误，未作为默认来源。TMDb 需要注册密钥；IGDB 涉及访问令牌、Client Secret 和后端代理，不在公开静态前端中接入。没有注册付费服务或嵌入任何秘密密钥。
- 请求由用户点击触发，间隔至少约一秒，有限内存缓存，不后台爬取。不自动重试限流响应。只发送检索词，不发送私人记录或评分。
- 三类元数据搜索已接入。海报和游戏封面覆盖率取决于公开来源；缺图不是用临时 URL 替代本地保存的理由，仍提供手动上传。
