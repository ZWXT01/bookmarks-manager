console.log(JSON.stringify({
  mode: 'obsolete-after-template-removal',
  skipped: true,
  reason: '旧分类交互脚本包含模板切换场景；模板移除后不再适用。',
  replacements: ['scripts/category-nav-validate.ts', 'scripts/ai-organize-ui-validate.ts'],
}, null, 2));
