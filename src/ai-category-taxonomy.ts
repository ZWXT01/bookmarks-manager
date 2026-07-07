const casefold = (value: string) => value.toLowerCase().trim();

function normalizeTaxonomyPath(path: string): string {
  return path.split('/').map(segment => segment.trim()).filter(Boolean).slice(0, 2).join('/');
}

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  '社区与资讯/热榜聚合': '核心：不带讨论的纯趋势、指数、信息流看板。',
  '社区与资讯/科技数码': '核心：IT、硬件、评测、生态、数码硬件资讯。',
  '社区与资讯/娱乐游戏综合': '核心：游戏新闻、动漫资讯、影评、维基百科与 Wiki。',
  '社区与资讯/讨论社区': '核心：以用户发帖交流为主的综合论坛、贴吧、社交网络。',
  '在线影音/在线影视': '核心：免下载直接观看的电影、美剧、港台剧、短剧流媒体平台。',
  '在线影音/动漫番剧': '核心：免下载直接观看的二次元动画、新番连载、国漫老番网站。',
  '在线影音/短视频与直播': '核心：以 UGC 短视频、游戏直播、秀场直播为主的流媒体。',
  '在线影音/音乐电台': '核心：在线听歌、白噪音、播客、网络 FM。',
  '图文阅读/网络小说': '核心：在线阅读的网文、原创小说、轻小说平台。',
  '图文阅读/在线漫画': '核心：在线观看的国漫、日漫、韩漫、条漫网站。',
  '图文阅读/电子书库': '核心：Z-Library、精校版、PDF、Mobi 等出版书/学术书的检索与阅读。',
  '游戏专区/游戏下载': '核心：PC 单机、3A 大作、破解版、学习版资源及各类游戏客户端下载。',
  '游戏专区/游戏辅助工具': '核心：游戏修改器、MOD、汉化补丁、存档共享、画质增强工具。',
  '终端应用下载/软件 - Windows': '核心：PC 端的纯净软件、破解版、绿色版、装机必备工具。',
  '终端应用下载/软件 - macOS': '核心：Mac 平台的破解软件、独立 App、Mac 专属生产力工具。',
  '终端应用下载/软件 - Android': '核心：安卓手机、电视 TV 端的 APK、修改版 App、应用市场。',
  '终端应用下载/软件 - iOS': '核心：iPhone/iPad 的 IPA 包、侧载源、TestFlight、越狱工具。',
  '媒体与素材下载/影视下载': '核心：高码率 PT 站点、BT 磁力站、字幕组、无损原盘离线下载。',
  '媒体与素材下载/音频素材': '核心：无损音乐 APE/FLAC、配乐、音效、白噪音离线文件下载。',
  '媒体与素材下载/平面与视觉': '核心：CC0 图库、插画素材、字体、壁纸、PNG/矢量图资源下载。',
  '效率与日常工具/临时隐私': '核心：接码平台、临时邮箱、匿名转发、隐私保护工具。',
  '效率与日常工具/格式与处理': '核心：音视频转码、PDF 编辑、图片压缩、文本排版、在线 OCR。',
  '效率与日常工具/网络与网盘': '核心：云盘、高速直链解析、网盘搜索引擎、速度测试工具。',
  '效率与日常工具/智能AI辅助': '核心：各种大模型、AI 画图、AI 写作、效率 Prompt 助手。',
  '绅士领域 [NSFW]/视频流媒体': '核心：在线直接观看的三次元、二次元、3D 成人视频站点。',
  '绅士领域 [NSFW]/视频与BT下载': '核心：高清离线成人视频、磁力链、PT/BT、字幕组站。',
  '绅士领域 [NSFW]/二次元本子': '核心：同人志、画廊、Pixiv R18、单页/打包本子下载与在线看。',
  '绅士领域 [NSFW]/静态写真': '核心：三次元 Cosplay、模特写真、套图、三次元 CG 图集。',
  '绅士领域 [NSFW]/绅士游戏': '核心：Galgame、拔作、成人 RPG、安卓/PC 黄油及存档、汉化补丁。',
  '绅士领域 [NSFW]/成人小说': '核心：纯文字的成人文学、H 文、离线长篇短篇 txt 小说。',
};

export function buildCategoryDescriptionGuide(categoryList: string[]): string {
  const available = new Set(categoryList.map(path => casefold(normalizeTaxonomyPath(path))));
  const lines = Object.entries(CATEGORY_DESCRIPTIONS)
    .filter(([path]) => available.has(casefold(normalizeTaxonomyPath(path))))
    .map(([path, description]) => `- ${path}：${description}`);
  return lines.length ? ['分类说明：', ...lines].join('\n') : '';
}
