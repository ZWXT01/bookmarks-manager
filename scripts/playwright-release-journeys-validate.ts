console.log(JSON.stringify({
  mode: 'obsolete-after-template-removal',
  skipped: true,
  reason: '旧 release journey 依赖分类模板 UI；模板移除后改由无模板回归脚本覆盖首页、分类与 AI 整理主路径。',
  replacement: 'scripts/ai-organize-ui-validate.ts',
}, null, 2));
