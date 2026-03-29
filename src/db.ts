import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      title TEXT NOT NULL,
      category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      last_checked_at TEXT NULL,
      check_status TEXT NOT NULL DEFAULT 'not_checked',
      check_http_code INTEGER NULL,
      check_error TEXT NULL,
      skip_check INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_canonical_url ON bookmarks(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_category_id ON bookmarks(category_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      message TEXT NULL,
      extra TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      input TEXT NOT NULL,
      reason TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_failures_job_id ON job_failures(job_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bookmark_id INTEGER REFERENCES bookmarks(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 性能优化索引
    CREATE INDEX IF NOT EXISTS idx_bookmarks_check_status ON bookmarks(check_status);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
    CREATE INDEX IF NOT EXISTS idx_snapshots_bookmark_id ON snapshots(bookmark_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);

    -- API Tokens 表
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);

    -- AI 整理计划表
    CREATE TABLE IF NOT EXISTS ai_organize_plans (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      status TEXT NOT NULL DEFAULT 'designing',
      scope TEXT NOT NULL DEFAULT 'all',
      target_tree TEXT,
      assignments TEXT,
      diff_summary TEXT,
      backup_snapshot TEXT,
      source_snapshot TEXT,
      phase TEXT,
      batches_done INTEGER NOT NULL DEFAULT 0,
      batches_total INTEGER NOT NULL DEFAULT 0,
      failed_batch_ids TEXT,
      needs_review_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      applied_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ai_organize_plans_status ON ai_organize_plans(status);

    CREATE TABLE IF NOT EXISTS plan_state_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL REFERENCES ai_organize_plans(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plan_state_logs_plan_id ON plan_state_logs(plan_id);

    -- 分类模板表
    CREATE TABLE IF NOT EXISTS category_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'preset',
      tree TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 模板书签快照表
    CREATE TABLE IF NOT EXISTS template_snapshots (
      template_id INTEGER NOT NULL REFERENCES category_templates(id) ON DELETE CASCADE,
      bookmark_id INTEGER NOT NULL,
      category_path TEXT NOT NULL,
      PRIMARY KEY (template_id, bookmark_id)
    );
  `);

  // 迁移：添加skip_check字段（如果不存在）
  const columns = db.prepare("PRAGMA table_info(bookmarks)").all() as Array<{ name: string }>;
  const hasSkipCheck = columns.some(col => col.name === 'skip_check');
  if (!hasSkipCheck) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN skip_check INTEGER NOT NULL DEFAULT 0`);
  }

  // 迁移：添加 description 字段（如果不存在）
  const hasDescription = columns.some(col => col.name === 'description');
  if (!hasDescription) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN description TEXT`);
  }

  // 迁移：添加 is_starred 字段（如果不存在）
  const hasIsStarred = columns.some(col => col.name === 'is_starred');
  if (!hasIsStarred) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookmarks_is_starred ON bookmarks(is_starred)`);
  }

  // 迁移：添加分类 icon 和 color 字段
  const catColumns = db.prepare("PRAGMA table_info(categories)").all() as Array<{ name: string }>;
  const hasIcon = catColumns.some(col => col.name === 'icon');
  if (!hasIcon) {
    db.exec(`ALTER TABLE categories ADD COLUMN icon TEXT`);
  }
  const hasColor = catColumns.some(col => col.name === 'color');
  if (!hasColor) {
    db.exec(`ALTER TABLE categories ADD COLUMN color TEXT`);
  }

  // 迁移：添加 jobs 表 extra 字段
  const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  const hasExtra = jobColumns.some(col => col.name === 'extra');
  if (!hasExtra) {
    db.exec(`ALTER TABLE jobs ADD COLUMN extra TEXT`);
  }

  // 迁移：添加分类 sort_order 字段（用于同级排序）
  const hasSortOrder = catColumns.some(col => col.name === 'sort_order');
  if (!hasSortOrder) {
    db.exec(`ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0`);
  }

  // 迁移：添加 bookmarks.updated_at 字段（冲突检测依赖）
  const hasUpdatedAt = columns.some(col => col.name === 'updated_at');
  if (!hasUpdatedAt) {
    db.exec(`ALTER TABLE bookmarks ADD COLUMN updated_at TEXT`);
    db.exec(`UPDATE bookmarks SET updated_at = created_at WHERE updated_at IS NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookmarks_updated_at ON bookmarks(updated_at)`);
  }

  // 迁移：删除旧 AI 建议表
  db.exec(`DROP TABLE IF EXISTS ai_classification_suggestions`);
  db.exec(`DROP TABLE IF EXISTS ai_simplify_suggestions`);
  db.exec(`DROP TABLE IF EXISTS ai_level_simplify_suggestions`);

  // 创建 parent_id 索引（用于树状查询）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`);

  // 迁移：取消旧 designing 状态的 Plan
  db.exec(`UPDATE ai_organize_plans SET status = 'canceled' WHERE status = 'designing'`);

  // 迁移：添加 ai_organize_plans.template_id 列
  const planColumns = db.prepare("PRAGMA table_info(ai_organize_plans)").all() as Array<{ name: string }>;
  if (!planColumns.some(col => col.name === 'template_id')) {
    db.exec(`ALTER TABLE ai_organize_plans ADD COLUMN template_id INTEGER REFERENCES category_templates(id)`);
  }
  if (!planColumns.some(col => col.name === 'source_snapshot')) {
    db.exec(`ALTER TABLE ai_organize_plans ADD COLUMN source_snapshot TEXT`);
  }

  // 迁移：修正预置模板 tree JSON 中含 / 的子分类名
  const slashTemplates = db.prepare(
    `SELECT id, tree FROM category_templates WHERE type = 'preset' AND tree LIKE '%/%'`
  ).all() as Array<{ id: number; tree: string }>;
  for (const t of slashTemplates) {
    const fixed = t.tree.replace(/UI\/UX/g, 'UI&UX')
      .replace(/JavaScript\/TypeScript/g, 'JavaScript&TypeScript')
      .replace(/CI\/CD/g, 'CI&CD');
    if (fixed !== t.tree) {
      db.prepare('UPDATE category_templates SET tree = ? WHERE id = ?').run(fixed, t.id);
    }
  }

  // 迁移：插入预置分类模板种子数据
  seedPresetTemplates(db);

  return db;
}

function seedPresetTemplates(db: Db): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM category_templates WHERE type = ?').get('preset') as { c: number }).c;
  if (count >= 4) return;

  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO category_templates (name, type, tree, is_active, created_at, updated_at)
     SELECT ?, 'preset', ?, 0, ?, ? WHERE NOT EXISTS (SELECT 1 FROM category_templates WHERE name = ?)`
  );

  const presets: { name: string; tree: object[] }[] = [
    {
      name: '综合通用版',
      tree: [
        { name: '技术开发', children: [{ name: '前端' }, { name: '后端' }, { name: '移动开发' }, { name: '数据库' }, { name: '运维与部署' }] },
        { name: '学习教育', children: [{ name: '在线课程' }, { name: '语言学习' }, { name: '阅读笔记' }, { name: '证书考试' }] },
        { name: '工具软件', children: [{ name: '效率工具' }, { name: '浏览器插件' }, { name: '写作笔记' }, { name: '安全隐私' }] },
        { name: '新闻资讯', children: [{ name: '科技资讯' }, { name: '财经资讯' }, { name: '国际新闻' }, { name: '行业动态' }] },
        { name: '社交媒体', children: [{ name: '微博' }, { name: '知乎' }, { name: '小红书' }, { name: 'Reddit' }] },
        { name: '娱乐影音', children: [{ name: '电影' }, { name: '电视剧' }, { name: '音乐' }, { name: '动漫' }, { name: '综艺' }] },
        { name: '购物电商', children: [{ name: '综合电商' }, { name: '海淘' }, { name: '优惠折扣' }, { name: '二手闲置' }] },
        { name: '生活服务', children: [{ name: '出行导航' }, { name: '住房租房' }, { name: '医疗健康' }, { name: '餐饮外卖' }, { name: '政务办事' }] },
        { name: '设计创意', children: [{ name: 'UI&UX' }, { name: '平面设计' }, { name: '灵感素材' }, { name: '字体图标' }] },
        { name: '金融理财', children: [{ name: '记账工具' }, { name: '基金股票' }, { name: '保险保障' }, { name: '宏观资讯' }] },
        { name: '游戏', children: [{ name: 'PC游戏' }, { name: '主机游戏' }, { name: '手游' }, { name: '独立游戏' }, { name: '攻略社区' }] },
        { name: '成人内容', children: [{ name: 'NSFW' }, { name: '成人社区' }, { name: '成人视频' }] },
      ],
    },
    {
      name: '开发者版',
      tree: [
        { name: '编程语言', children: [{ name: 'JavaScript&TypeScript' }, { name: 'Python' }, { name: 'Go' }, { name: 'Rust' }, { name: 'Java' }] },
        { name: '框架与库', children: [{ name: '前端框架' }, { name: '后端框架' }, { name: 'UI组件' }, { name: '数据处理' }, { name: '测试工具' }] },
        { name: '开发工具', children: [{ name: 'IDE编辑器' }, { name: 'Git版本控制' }, { name: '构建与打包' }, { name: '调试与性能' }, { name: 'API调试' }] },
        { name: '云服务与运维', children: [{ name: '容器与K8s' }, { name: 'CI&CD' }, { name: '监控与日志' }, { name: '网络与安全' }, { name: 'Serverless' }] },
        { name: '技术社区', children: [{ name: 'GitHub' }, { name: 'Stack Overflow' }, { name: '掘金' }, { name: 'V2EX' }, { name: 'Hacker News' }] },
        { name: '学习资源', children: [{ name: '官方文档' }, { name: '系列教程' }, { name: '书籍' }, { name: '在线课程' }, { name: '代码示例' }] },
        { name: 'AI与数据', children: [{ name: '大模型LLM' }, { name: '机器学习' }, { name: '数据分析' }, { name: '数据工程' }, { name: '向量数据库' }] },
        { name: '开源项目', children: [{ name: 'Star清单' }, { name: '贡献指南' }, { name: 'Issue跟踪' }, { name: 'Release更新' }] },
        { name: '职业发展', children: [{ name: '简历面试' }, { name: '进阶路线' }, { name: '工程管理' }, { name: '远程工作' }, { name: '软技能' }] },
        { name: '其他', children: [{ name: '灵感想法' }, { name: '工具脚本' }, { name: '会议活动' }] },
      ],
    },
    {
      name: '生活娱乐版',
      tree: [
        { name: '购物电商', children: [{ name: '综合电商' }, { name: '海淘' }, { name: '优惠返利' }, { name: '二手闲置' }] },
        { name: '美食餐饮', children: [{ name: '菜谱' }, { name: '餐厅点评' }, { name: '外卖' }, { name: '咖啡茶饮' }] },
        { name: '旅行出行', children: [{ name: '机酒预订' }, { name: '攻略游记' }, { name: '交通导航' }, { name: '目的地' }] },
        { name: '健康运动', children: [{ name: '健身训练' }, { name: '跑步骑行' }, { name: '营养饮食' }, { name: '医疗科普' }] },
        { name: '影视音乐', children: [{ name: '影视资讯' }, { name: '片单推荐' }, { name: '音乐播放器' }, { name: '演出活动' }] },
        { name: '游戏', children: [{ name: '攻略评测' }, { name: '发行平台' }, { name: '社区论坛' }, { name: '直播视频' }] },
        { name: '社交', children: [{ name: '微信公众号' }, { name: '微博' }, { name: '小红书' }, { name: 'Discord' }] },
        { name: '新闻资讯', children: [{ name: '国内新闻' }, { name: '国际新闻' }, { name: '科技资讯' }, { name: '财经资讯' }] },
        { name: '学习成长', children: [{ name: '阅读' }, { name: '技能学习' }, { name: '语言学习' }, { name: '自我管理' }] },
        { name: '实用工具', children: [{ name: '记账理财' }, { name: '图片视频' }, { name: '在线工具' }, { name: '生活查询' }] },
      ],
    },
    {
      name: '极简版',
      tree: [
        { name: '工作', children: [{ name: '待办' }, { name: '文档' }, { name: '协作' }] },
        { name: '学习', children: [{ name: '课程' }, { name: '阅读' }, { name: '笔记' }] },
        { name: '生活', children: [{ name: '购物' }, { name: '出行' }, { name: '健康' }] },
        { name: '娱乐', children: [{ name: '影视' }, { name: '音乐' }, { name: '游戏' }] },
        { name: '工具', children: [{ name: '在线工具' }, { name: '浏览器扩展' }, { name: '下载' }] },
        { name: '其他', children: [{ name: '临时' }, { name: '收藏' }] },
      ],
    },
  ];

  for (const p of presets) {
    stmt.run(p.name, JSON.stringify(p.tree), now, now, p.name);
  }
}
