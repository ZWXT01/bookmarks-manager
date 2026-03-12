function bookmarkApp() {
  return {
    currentCategory: null,
    searchKeyword: '',
    bookmarks: [],
    displayBookmarks: [],
    selectedBookmarks: [],
    selectionContext: null,
    selectedCategories: [],
    importOverrideCategory: false, // 导入时是否忽略原有分类
    categories: [],
    categoryTree: [], // 树状分类数据
    expandedCategories: new Set(), // 展开的一级分类ID
    categorySearch: '',
    totalCount: 0,
    uncategorizedCount: 0,
    newBookmark: { url: '', title: '', category_id: '' },
    aiSuggestion: '',
    moveTargetCategory: '',
    searchDebounceTimer: null, // 搜索去抖计时器

    // 主题
    theme: localStorage.getItem('theme') || 'system',

    // 高级搜索选项
    showAdvancedSearch: false,
    advancedSearch: {
      status: 'all',
      skipCheck: 'all',
      dateFrom: '',
      dateTo: '',
      domain: '',
      sort: 'id',
      order: 'desc',
    },

    showEditModal: false,
    editBookmark: { id: null, url: '', title: '' },

    showMoveOneModal: false,
    moveOneBookmarkId: null,
    moveOneTargetCategory: '',

    showCategoryStyleModal: false,
    styleCategory: null,
    categoryIcon: '',
    categoryColor: '',

    showCreateCategoryModal: false,
    createCategoryParentId: null,
    createCategoryName: '',
    createCategoryIcon: '',
    createCategoryColor: '',

    // 视图模式
    viewMode: localStorage.getItem('viewMode') || 'table', // 'table' or 'card'

    // 分类管理 (Phase 1)
    showCategoryManager: false,
    categoryManagerSearch: '',
    activeParentCategory: null,
    categoryDropdownVisible: false,
    showAddBookmarkModal: false,
    showMobileSidebar: false,

    showMoveSelectedModal: false,
    moveSelectedTargetCategory: '',

    showCheckModal: false,
    checkOptions: { scope: 'all', retries: '1', retry_delay_ms: '500', categoryIds: [] },
    checkJobId: null,
    checkStats: { processed: 0, total: 0, inserted: 0, failed: 0 },
    checkProgress: 0,
    importJobId: null,
    importStats: { processed: 0, total: 0, inserted: 0, failed: 0 },
    importProgress: 0,
    showImportProgressModal: false,
    checkJobDone: false,
    showBackupModal: false,
    showExportModal: false,
    exportScope: 'all',
    exportFormat: 'html',
    showAIOrganizeModal: false,
    organizeScope: 'all',
    organizeScopeCategoryId: '',
    organizePlan: null,
    organizePhase: 'idle', // idle, assigning, preview, applied, failed
    organizeProgress: { batches_done: 0, batches_total: 0, failed_batch_ids: [], needs_review_count: 0 },
    organizePollTimer: null,
    organizeDiff: null,
    organizeConflicts: [],
    organizeEmptyCategories: [],
    organizeResolving: false,
    organizeAppliedCount: 0,
    organizeDiffExpanded: {},
    pendingPlans: [],
    backups: [],
    selectedManualBackup: '',
    selectedAutoBackup: '',
    eventSource: null,
    jobType: 'check',
    statusFilter: 'all',
    allCategoryIds: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    lastJobId: null,
    lastJobType: null,
    settings: null,
    openDropdownId: null,
    currentJob: null,
    currentJobPollTimer: null,

    // 模板管理
    templates: [],
    activeTemplate: null,
    showTemplateSelectModal: false,
    showTemplateEditModal: false,
    templateEditTarget: null,
    templateEditName: '',
    templateEditTree: [],
    templateApplying: false,
    templateEditSnapshot: null,
    templateEditSourceId: null,

    get presetTemplates() { return this.templates.filter(t => t.type === 'preset'); },
    get customTemplates() { return this.templates.filter(t => t.type === 'custom'); },

    // 多入口 AI 分类
    showBatchSizeModal: false,
    classifyBatchIds: [],
    classifyBatchSize: 20,

    async init() {
      this.initTheme();
      await this.loadCategories();
      await this.loadBookmarks();
      await this.loadSettings();
      await this.loadTemplates();
      this.restoreLastJob();
      this.pollCurrentJob();
    },

    initTheme() {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        this.theme = 'dark';
      } else if (saved === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        this.theme = 'light';
      } else {
        this.theme = 'system';
      }
    },

    toggleTheme() {
      if (this.theme === 'dark') {
        this.theme = 'light';
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
      } else {
        this.theme = 'dark';
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      }
    },



    async loadSettings() {
      try {
        const res = await fetch('/api/settings', { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) return;
        this.settings = data;

        // 仅在初始化时覆盖默认值，避免影响用户已手动修改的输入
        if (this.checkOptions && String(this.checkOptions.retries) === '1' && data.check_retries != null) {
          this.checkOptions.retries = String(data.check_retries);
        }
        if (this.checkOptions && String(this.checkOptions.retry_delay_ms) === '500' && data.check_retry_delay_ms != null) {
          this.checkOptions.retry_delay_ms = String(data.check_retry_delay_ms);
        }
      } catch {
      }
    },

    async pollCurrentJob() {
      try {
        const res = await fetch('/api/jobs/current', { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.job) {
          const prevJob = this.currentJob;
          this.currentJob = data.job;

          // 检测任务状态变化，显示弹窗提示
          if (prevJob && prevJob.id === data.job.id) {
            if (prevJob.status === 'running' && data.job.status === 'done') {
              const jobType = data.job.type === 'ai_organize' ? 'AI整理' : '检查';
              this.showToast(`${jobType}任务已完成`, 'success');
            } else if (prevJob.status === 'running' && data.job.status === 'failed') {
              const jobType = data.job.type === 'ai_organize' ? 'AI整理' : '检查';
              this.showToast(`${jobType}任务失败`, 'error');
            } else if (prevJob.status === 'running' && data.job.status === 'canceled') {
              const jobType = data.job.type === 'ai_organize' ? 'AI整理' : '检查';
              this.showToast(`${jobType}任务已取消`, 'info');
            }
          }
        } else {
          // 如果之前有任务，现在没有了，可能是任务完成了
          if (this.currentJob && this.currentJob.status === 'running') {
            // 任务可能刚完成，再查一次确认
          }
          this.currentJob = null;
        }
      } catch {
        this.currentJob = null;
      }
      // 每3秒轮询一次
      this.currentJobPollTimer = setTimeout(() => this.pollCurrentJob(), 3000);
    },

    async cancelCurrentJob() {
      if (!this.currentJob) return;
      const jobType = this.currentJob.type;
      const jobId = this.currentJob.id;
      try {
        let res;
        if (jobType === 'ai_organize' && this.organizePlan?.id) {
          res = await fetch('/api/ai/organize/' + this.organizePlan.id + '/cancel', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
          });
        } else {
          const cancelUrl = jobType === 'check' ? '/api/check/cancel' : `/api/jobs/${jobId}/cancel`;
          res = await fetch(cancelUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ jobId: jobId })
          });
        }
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success) {
          this.showToast('任务已取消', 'info');
          this.currentJob = null;
        } else {
          this.showToast((data && data.error) || '取消失败', 'error');
        }
      } catch {
        this.showToast('取消失败', 'error');
      }
    },

    openMoveSelectedModal() {
      this.ensureSelectionContext();
      if (!this.selectedBookmarks || this.selectedBookmarks.length === 0) {
        this.showToast('请先勾选要移动的书签', 'error');
        return;
      }
      this.moveSelectedTargetCategory = '';
      this.showMoveSelectedModal = true;
    },

    closeMoveSelectedModal() {
      this.showMoveSelectedModal = false;
      this.moveSelectedTargetCategory = '';
    },

    async confirmMoveSelectedBookmarks() {
      this.ensureSelectionContext();
      const ids = (this.selectedBookmarks || []).map((x) => String(x)).filter(Boolean);
      if (ids.length === 0) {
        this.showToast('请先勾选要移动的书签', 'error');
        return;
      }
      if (!this.moveSelectedTargetCategory) return;

      try {
        const params = new URLSearchParams();
        ids.forEach((id) => params.append('bookmark_ids[]', id));
        params.append('target_category', String(this.moveSelectedTargetCategory));
        const res = await fetch('/api/bookmarks/move', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          this.showToast('已移动', 'success');
          this.selectedBookmarks = [];
          this.closeMoveSelectedModal();
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast((data && data.error) ? data.error : '移动失败', 'error');
        }
      } catch {
        this.showToast('移动失败', 'error');
      }
    },

    openEditBookmark(bookmark) {
      if (!bookmark) return;
      this.editBookmark = {
        id: bookmark.id,
        url: String(bookmark.url || ''),
        title: String(bookmark.title || ''),
      };
      this.showEditModal = true;
    },

    closeEditModal() {
      this.showEditModal = false;
      this.editBookmark = { id: null, url: '', title: '' };
    },

    async saveEditBookmark() {
      const b = this.editBookmark || {};
      const id = b.id;
      if (!id) return;
      const url = String(b.url || '').trim();
      const title = String(b.title || '').trim();
      if (!url) {
        this.showToast('URL不能为空', 'error');
        return;
      }

      try {
        const params = new URLSearchParams();
        params.append('url', url);
        params.append('title', title);

        const res = await fetch(`/api/bookmarks/${id}/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          this.showToast('书签已更新', 'success');
          this.closeEditModal();
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast((data && data.error) ? data.error : '更新失败', 'error');
        }
      } catch {
        this.showToast('更新失败', 'error');
      }
    },

    openMoveBookmark(bookmark) {
      if (!bookmark) return;
      this.moveOneBookmarkId = bookmark.id;
      this.moveOneTargetCategory = '';
      this.showMoveOneModal = true;
    },

    closeMoveOneModal() {
      this.showMoveOneModal = false;
      this.moveOneBookmarkId = null;
      this.moveOneTargetCategory = '';
    },



    openCategoryStyleModal(category) {
      if (!category) return;
      this.styleCategory = category;
      this.categoryIcon = category.icon || '';
      this.categoryColor = category.color || '';
      this.showCategoryStyleModal = true;
    },

    closeCategoryStyleModal() {
      this.showCategoryStyleModal = false;
      this.styleCategory = null;
      this.categoryIcon = '';
      this.categoryColor = '';
    },

    async saveCategoryStyle() {
      if (!this.styleCategory) return;
      const id = this.styleCategory.id;

      try {
        const res = await fetch(`/api/categories/${id}/style`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ icon: this.categoryIcon, color: this.categoryColor }),
        });

        if (res.ok) {
          await this.loadCategories();
          this.closeCategoryStyleModal();
        } else {
          const data = await res.json();
          await AppDialog.alert(data.error || '保存失败');
        }
      } catch (e) {
        await AppDialog.alert('保存失败: ' + e.message);
      }
    },

    toggleViewMode() {
      this.viewMode = this.viewMode === 'table' ? 'card' : 'table';
      localStorage.setItem('viewMode', this.viewMode);
    },

    async confirmMoveOneBookmark() {
      const id = this.moveOneBookmarkId;
      if (!id) return;
      if (!this.moveOneTargetCategory) return;

      try {
        const params = new URLSearchParams();
        params.append('bookmark_ids[]', String(id));
        params.append('target_category', String(this.moveOneTargetCategory));
        const res = await fetch('/api/bookmarks/move', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          this.showToast('已移动', 'success');
          const sid = String(id);
          this.selectedBookmarks = (this.selectedBookmarks || []).map((x) => String(x)).filter((x) => x !== sid);
          this.closeMoveOneModal();
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast((data && data.error) ? data.error : '移动失败', 'error');
        }
      } catch {
        this.showToast('移动失败', 'error');
      }
    },

    async startCheckOne(bookmarkId) {
      const id = String(bookmarkId || '').trim();
      if (!id) return;

      try {
        const params = new URLSearchParams();
        params.append('scope', 'selected');
        params.append('retries', this.checkOptions.retries);
        params.append('retry_delay_ms', this.checkOptions.retry_delay_ms);
        params.append('bookmark_ids[]', id);

        const response = await fetch('/api/check/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || !data.jobId) {
          this.showToast((data && data.error) ? data.error : '启动检查失败', 'error');
          return;
        }

        this.jobType = 'check';
        this.checkJobId = data.jobId;
        this.lastJobId = data.jobId;
        this.lastJobType = 'check';
        this.persistLastJob();
        this.showCheckModal = true;
        this.subscribeToJobProgress();
      } catch {
        this.showToast('启动检查失败', 'error');
      }
    },

    async cancelCheckJob() {
      if (!this.checkJobId) return;
      if (!await AppDialog.confirm('确认取消当前检查任务？')) return;
      try {
        const params = new URLSearchParams();
        params.append('jobId', String(this.checkJobId));
        const res = await fetch('/api/check/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          const status = data && typeof data.status === 'string' ? data.status : '';
          this.showToast(status === 'canceled' ? '已取消' : '已请求取消', 'info');
          try {
            if (this.eventSource) {
              this.eventSource.close();
              this.eventSource = null;
            }
          } catch {
          }
          this.checkJobId = null;
        } else {
          this.showToast((data && data.error) ? data.error : '取消失败', 'error');
        }
      } catch {
        this.showToast('取消失败', 'error');
      }
    },

    selectionContextKey() {
      try {
        return JSON.stringify({
          category: this.currentCategory,
          q: this.searchKeyword || '',
          status: this.statusFilter || 'all',
        });
      } catch {
        return '';
      }
    },

    async moveSelectedBookmarks() {
      this.ensureSelectionContext();
      const ids = (this.selectedBookmarks || []).map((x) => String(x)).filter(Boolean);
      if (ids.length === 0) {
        this.showToast('请先勾选要移动的书签', 'error');
        return;
      }
      if (!this.moveTargetCategory) return;

      try {
        const params = new URLSearchParams();
        ids.forEach((id) => params.append('bookmark_ids[]', id));
        params.append('target_category', String(this.moveTargetCategory));
        const res = await fetch('/api/bookmarks/move', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          this.showToast('已移动', 'success');
          this.selectedBookmarks = [];
          this.moveTargetCategory = '';
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast((data && data.error) ? data.error : '移动失败', 'error');
        }
      } catch {
        this.showToast('移动失败', 'error');
      }
    },

    ensureSelectionContext() {
      const next = this.selectionContextKey();
      if (this.selectionContext !== next) {
        this.selectedBookmarks = [];
        this.selectionContext = next;
      }
    },

    restoreLastJob() {
      try {
        const id = localStorage.getItem('bm_last_job_id');
        const type = localStorage.getItem('bm_last_job_type');
        if (id) this.lastJobId = id;
        if (type) this.lastJobType = type;
      } catch {
      }
    },

    persistLastJob() {
      try {
        if (this.lastJobId) localStorage.setItem('bm_last_job_id', String(this.lastJobId));
        if (this.lastJobType) localStorage.setItem('bm_last_job_type', String(this.lastJobType));
      } catch {
      }
    },

    async loadCategories() {
      try {
        // 获取树状结构
        const res = await fetch('/api/categories?tree=true');
        const data = await res.json();
        console.log('[DEBUG] loadCategories response:', data);
        this.categoryTree = data.tree || [];
        console.log('[DEBUG] categoryTree:', this.categoryTree);
        this.totalCount = data.totalCount || 0;
        this.uncategorizedCount = data.uncategorizedCount || 0;

        // 扁平化为兼容旧格式的 categories 数组
        this.categories = this.flattenCategoryTree(this.categoryTree);
        this.initAllCategoryIds();
      } catch (e) {
        this.showToast('加载分类失败', 'error');
      }
    },

    // 将树状结构扁平化
    flattenCategoryTree(tree) {
      const result = [];
      for (const node of tree) {
        result.push({
          id: node.id,
          name: node.fullPath || node.name,
          count: node.count,
          icon: node.icon,
          color: node.color,
          parent_id: node.parent_id,
          level: 0,
        });
        for (const child of (node.children || [])) {
          result.push({
            id: child.id,
            name: child.fullPath || child.name,
            count: child.count,
            icon: child.icon,
            color: child.color,
            parent_id: child.parent_id,
            level: 1,
          });
        }
      }
      return result;
    },

    // 切换一级分类展开/折叠
    toggleCategoryExpand(categoryId) {
      if (this.expandedCategories.has(categoryId)) {
        this.expandedCategories.delete(categoryId);
      } else {
        this.expandedCategories.add(categoryId);
      }
      // 触发响应式更新
      this.expandedCategories = new Set(this.expandedCategories);
    },

    // 检查分类是否展开
    isCategoryExpanded(categoryId) {
      return this.expandedCategories.has(categoryId);
    },

    // 分类导航辅助方法 (Phase 1)
    toggleCategoryDropdown(parentId) {
      if (this.activeParentCategory === parentId && this.categoryDropdownVisible) {
        this.closeCategoryDropdown();
      } else {
        this.activeParentCategory = parentId;
        this.categoryDropdownVisible = true;
      }
    },

    openCategoryDropdown(parentId) {
      this.activeParentCategory = parentId;
      this.categoryDropdownVisible = true;
    },

    closeCategoryDropdown() {
      this.categoryDropdownVisible = false;
      this.activeParentCategory = null;
    },

    openCategoryManager() {
      this.showCategoryManager = true;
      this.categoryManagerSearch = '';
      // Focus management: auto-focus search input when modal opens
      this.$nextTick(() => {
        const searchInput = document.querySelector('#category-manager-search');
        if (searchInput) searchInput.focus();
      });
    },

    closeCategoryManager() {
      this.showCategoryManager = false;
    },

    openAddBookmarkModal() {
      this.showAddBookmarkModal = true;
    },

    closeAddBookmarkModal() {
      this.showAddBookmarkModal = false;
    },

    // 过滤后的分类树（用于管理弹窗）
    get filteredCategoryTree() {
      if (!this.categoryManagerSearch.trim()) {
        return this.categoryTree;
      }
      const keyword = this.categoryManagerSearch.toLowerCase().trim();
      
      const filterNodes = (nodes) => {
        return nodes.map(node => {
          const nameMatches = node.name.toLowerCase().includes(keyword);
          const children = node.children ? filterNodes(node.children) : [];
          const childrenMatch = children.length > 0;
          
          if (nameMatches || childrenMatch) {
            return { ...node, children, isMatch: nameMatches };
          }
          return null;
        }).filter(Boolean);
      };
      
      return filterNodes(this.categoryTree);
    },

    initAllCategoryIds() {
      try {
        this.allCategoryIds = (this.categories || [])
          .map((c) => String(c.id))
          .filter((x) => x && x !== '0');
      } catch {
        this.allCategoryIds = [];
      }
    },

    exportCurrentCategoryLabel() {
      if (this.currentCategory === null) return '导出当前分类：全部';
      if (this.currentCategory === 'uncategorized') return '导出当前分类：未分类';
      const id = Number(this.currentCategory);
      if (!Number.isFinite(id)) return '导出当前分类';
      const c = (this.categories || []).find((x) => Number(x.id) === id);
      return `导出当前分类：${c ? c.name : '分类'}`;
    },

    exportCurrentCategoryUrl() {
      if (this.currentCategory === null) return '/export';
      if (this.currentCategory === 'uncategorized') return '/export?category=uncategorized';
      return `/export?category=${this.currentCategory}`;
    },

    formatBytes(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
      const val = n / Math.pow(1024, exp);
      const fixed = exp === 0 ? 0 : val >= 10 ? 1 : 2;
      return `${val.toFixed(fixed)} ${units[exp]}`;
    },

    get manualBackups() {
      return this.backups.filter(b => b.type === 'manual');
    },

    get autoBackups() {
      return this.backups.filter(b => b.type === 'auto');
    },

    openBackupModal() {
      this.showBackupModal = true;
      this.loadBackups();
    },

    closeBackupModal() {
      this.showBackupModal = false;
    },

    async loadBackups() {
      try {
        const res = await fetch('/api/backups', { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          this.backups = (data && Array.isArray(data.backups)) ? data.backups : [];
        } else {
          this.showToast((data && data.error) ? data.error : '读取备份列表失败', 'error');
        }
      } catch {
        this.showToast('读取备份列表失败', 'error');
      }
    },

    async runBackupNow() {
      try {
        const res = await fetch('/api/backups/run', { method: 'POST', headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          if (data && data.skipped) {
            this.showToast(data.message || '当前无书签，跳过备份', 'info');
          } else {
            this.showToast('备份已创建', 'success');
            await this.loadBackups();
          }
        } else {
          this.showToast((data && data.error) ? data.error : '备份失败', 'error');
        }
      } catch {
        this.showToast('备份失败', 'error');
      }
    },

    async deleteBackup(name) {
      if (!await AppDialog.confirm(`确定要删除备份 ${name} 吗？`)) return;
      try {
        const res = await fetch(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          this.showToast('备份已删除', 'success');
          if (this.selectedManualBackup === name) this.selectedManualBackup = '';
          if (this.selectedAutoBackup === name) this.selectedAutoBackup = '';
          await this.loadBackups();
        } else {
          this.showToast((data && data.error) ? data.error : '删除失败', 'error');
        }
      } catch {
        this.showToast('删除失败', 'error');
      }
    },

    async restoreBackup(name) {
      if (!await AppDialog.confirm(`确定要从 ${name} 还原数据库吗？还原后需要刷新页面。`)) return;
      try {
        const res = await fetch('/api/backups/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success) {
          await AppDialog.alert(data.message || '数据库已还原，页面将刷新');
          window.location.reload();
        } else {
          this.showToast((data && data.error) || '还原失败', 'error');
        }
      } catch {
        this.showToast('还原失败', 'error');
      }
    },

    async uploadAndRestore(event) {
      const form = event.target;
      const fileInput = form.querySelector('input[type="file"]');
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        this.showToast('请选择要上传的 .db 文件', 'error');
        return;
      }
      const file = fileInput.files[0];
      if (!file.name.endsWith('.db')) {
        this.showToast('请选择 .db 格式的数据库文件', 'error');
        return;
      }
      if (!await AppDialog.confirm(`确定要从上传的文件还原数据库吗？还原后需要刷新页面。`)) return;

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/backups/restore', {
          method: 'POST',
          body: formData
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success) {
          await AppDialog.alert(data.message || '数据库已还原，页面将刷新');
          window.location.reload();
        } else {
          this.showToast((data && data.error) || '还原失败', 'error');
        }
      } catch {
        this.showToast('还原失败', 'error');
      }
    },

    async loadBookmarks() {
      try {
        this.ensureSelectionContext();
        const params = new URLSearchParams();
        if (this.currentCategory !== null) {
          params.append('category', this.currentCategory);
        }
        if (this.searchKeyword) {
          params.append('q', this.searchKeyword);
        }
        if (this.statusFilter && this.statusFilter !== 'all') {
          params.append('status', this.statusFilter);
        }

        // 高级搜索选项
        if (this.advancedSearch) {
          if (this.advancedSearch.status && this.advancedSearch.status !== 'all') {
            params.append('status', this.advancedSearch.status);
          }
          if (this.advancedSearch.skipCheck && this.advancedSearch.skipCheck !== 'all') {
            params.append('skip_check', this.advancedSearch.skipCheck);
          }
          if (this.advancedSearch.dateFrom) {
            params.append('date_from', this.advancedSearch.dateFrom);
          }
          if (this.advancedSearch.dateTo) {
            params.append('date_to', this.advancedSearch.dateTo);
          }
          if (this.advancedSearch.domain) {
            params.append('domain', this.advancedSearch.domain);
          }
          if (this.advancedSearch.sort) {
            params.append('sort', this.advancedSearch.sort);
          }
          if (this.advancedSearch.order) {
            params.append('order', this.advancedSearch.order);
          }
        }

        params.append('page', String(this.page));
        params.append('pageSize', String(this.pageSize));

        const response = await fetch(`/api/bookmarks?${params}`);
        const data = await response.json();
        this.bookmarks = data.bookmarks || [];
        this.displayBookmarks = this.bookmarks;
        this.total = data.total || 0;
        this.page = data.page || this.page;
        this.pageSize = data.pageSize || this.pageSize;
        this.totalPages = data.totalPages || 1;
      } catch (error) {
        console.error('Failed to load bookmarks:', error);
        this.showToast('加载书签失败', 'error');
      }
    },

    // 重置高级搜索
    resetAdvancedSearch() {
      this.advancedSearch = {
        status: 'all',
        skipCheck: 'all',
        dateFrom: '',
        dateTo: '',
        domain: '',
        sort: 'id',
        order: 'desc',
      };
      this.searchKeyword = '';
      this.page = 1;
      this.loadBookmarks();
    },

    // 应用高级搜索
    applyAdvancedSearch() {
      this.page = 1;
      this.loadBookmarks();
    },

    async goToPage(p) {
      const next = Number(p);
      if (!Number.isFinite(next)) return;
      const clamped = Math.min(Math.max(1, next), this.totalPages || 1);
      this.page = clamped;
      await this.loadBookmarks();
    },

    async prevPage() {
      await this.goToPage(this.page - 1);
    },

    async nextPage() {
      await this.goToPage(this.page + 1);
    },

    get allCategoriesSelected() {
      return this.allCategoryIds.length > 0 && this.selectedCategories.length === this.allCategoryIds.length;
    },

    get filteredCategories() {
      if (!this.categorySearch.trim()) {
        return this.categories;
      }
      const keyword = this.categorySearch.toLowerCase().trim();
      return this.categories.filter(c => c.name.toLowerCase().includes(keyword));
    },

    toggleAllCategories(event) {
      if (event.target.checked) {
        this.selectedCategories = [...this.allCategoryIds];
      } else {
        this.selectedCategories = [];
      }
    },

    formatTime(iso) {
      try {
        return new Date(iso).toLocaleString('zh-CN');
      } catch {
        return '';
      }
    },

    formatCheckDetail(bookmark) {
      const code = bookmark && bookmark.check_http_code != null ? String(bookmark.check_http_code) : '';
      const err = bookmark && typeof bookmark.check_error === 'string' ? bookmark.check_error : '';
      if (code || err) {
        return [code, err].filter(Boolean).join(' ');
      }
      return '';
    },

    closeAllDropdowns() {
      this.openDropdownId = null;
    },

    openDropdown(id) {
      this.openDropdownId = id;
    },

    async loadCategory(categoryId) {
      this.currentCategory = categoryId;
      this.page = 1;
      this.closeCategoryDropdown();
      await this.loadBookmarks();
    },

    searchBookmarks() {
      this.page = 1;
      this.loadBookmarks();
    },

    // 防抖搜索：输入后 300ms 自动触发搜索
    debouncedSearch() {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchDebounceTimer = setTimeout(() => {
        this.page = 1;
        this.loadBookmarks();
      }, 300);
    },

    openCreateCategoryModal(parentId = null) {
      this.createCategoryParentId = parentId;
      this.createCategoryName = '';
      this.createCategoryIcon = '';
      this.createCategoryColor = '';
      this.showCreateCategoryModal = true;
    },

    closeCreateCategoryModal() {
      this.showCreateCategoryModal = false;
    },

    async confirmCreateCategory() {
      if (!this.createCategoryName.trim()) return;
      try {
        const body = { name: this.createCategoryName.trim() };
        if (this.createCategoryParentId !== null) body.parent_id = this.createCategoryParentId;
        if (this.createCategoryIcon) body.icon = this.createCategoryIcon;
        if (this.createCategoryColor) body.color = this.createCategoryColor;
        const response = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (response.ok && data?.category) {
          this.showToast(this.createCategoryParentId ? '子分类已创建' : '分类已创建', 'success');
          this.closeCreateCategoryModal();
          await this.loadCategories();
          if (this.createCategoryParentId !== null) {
            this.expandedCategories.add(this.createCategoryParentId);
            this.expandedCategories = new Set(this.expandedCategories);
          }
        } else {
          this.showToast(data?.error || '创建分类失败', 'error');
        }
      } catch {
        this.showToast('创建分类失败', 'error');
      }
    },

    // 删除分类
    async deleteCategory(categoryId) {
      if (!await AppDialog.confirm('确认删除此分类？分类下的书签将移到未分类。')) return;

      try {
        const response = await fetch(`/api/categories/${categoryId}`, {
          method: 'DELETE',
          headers: { 'Accept': 'application/json' },
        });
        const data = await response.json();
        if (response.ok && data && data.success) {
          this.showToast(`分类已删除，${data.movedBookmarks || 0} 个书签移到未分类`, 'success');
          await this.loadCategories();
          await this.loadBookmarks();
          if (this.currentCategory === categoryId) {
            this.currentCategory = null;
          }
        } else {
          this.showToast((data && data.error) ? data.error : '删除失败', 'error');
        }
      } catch (error) {
        this.showToast('删除失败', 'error');
      }
    },

    async batchDeleteCategories() {
      if (this.selectedCategories.length === 0) return;
      if (!await AppDialog.confirm(`确认删除选中的 ${this.selectedCategories.length} 个分类？\n注意：分类删除后，所属书签将变为未分类。`)) return;
      try {
        const params = new URLSearchParams();
        this.selectedCategories.forEach((id) => params.append('category_ids[]', String(id)));
        const res = await fetch('/categories/batch-delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          const deletedIds = new Set(this.selectedCategories.map((x) => Number(x)));
          this.showToast(`已删除 ${this.selectedCategories.length} 个分类`, 'success');
          this.selectedCategories = [];
          if (this.currentCategory !== null && this.currentCategory !== 'uncategorized' && deletedIds.has(Number(this.currentCategory))) {
            this.currentCategory = null;
            this.page = 1;
          }
          await this.loadCategories();
          await this.loadBookmarks();
        } else {
          this.showToast((data && data.error) ? data.error : '批量删除分类失败', 'error');
        }
      } catch (e) {
        this.showToast('批量删除分类失败', 'error');
      }
    },

    // 获取所有分类 ID（用于全选功能）
    getAllCategoryIds() {
      const ids = [];
      const collectIds = (cats) => {
        cats.forEach(cat => {
          ids.push(String(cat.id));
          if (cat.children && cat.children.length > 0) {
            collectIds(cat.children);
          }
        });
      };
      collectIds(this.categoryTree);
      return ids;
    },

    // 全选/取消全选分类
    toggleSelectAllCategories(checked) {
      if (checked) {
        this.selectedCategories = this.getAllCategoryIds();
      } else {
        this.selectedCategories = [];
      }
    },

    async aiSuggestNewBookmark() {
      if (!this.newBookmark.url.trim() && !this.newBookmark.title.trim()) {
        this.showToast('请先输入 URL 或标题', 'error');
        return;
      }
      try {
        const params = new URLSearchParams();
        params.append('url', this.newBookmark.url);
        params.append('title', this.newBookmark.title);
        const response = await fetch('/api/ai/classify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await response.json();
        if (response.ok && data.category) {
          this.aiSuggestion = data.category;
          this.showToast('AI 建议已生成', 'success');
        } else {
          this.showToast((data && data.error) ? data.error : 'AI 分类失败', 'error');
        }
      } catch (error) {
        this.showToast('AI 分类请求失败', 'error');
      }
    },

    async addBookmark() {
      if (!this.newBookmark.url.trim()) return;

      try {
        const params = new URLSearchParams();
        params.append('url', this.newBookmark.url);
        params.append('title', this.newBookmark.title);
        if (this.newBookmark.category_id) params.append('category_id', this.newBookmark.category_id);
        const response = await fetch('/api/bookmarks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });
        const data = await response.json();
        if (response.ok) {
          this.showToast('书签已添加', 'success');
          this.newBookmark = { url: '', title: '', category_id: '' };
          this.aiSuggestion = '';
          this.showAddBookmarkModal = false;
          this.page = 1;
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast((data && data.error) ? data.error : '添加书签失败', 'error');
        }
      } catch (error) {
        this.showToast('添加书签失败', 'error');
      }
    },

    async deleteBookmark(id) {
      if (!await AppDialog.confirm('确认删除该书签？')) return;
      try {
        const formData = new FormData();
        formData.append('redirect', '/');
        const response = await fetch(`/bookmarks/${id}/delete`, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: formData,
        });
        if (response.ok) {
          this.showToast('书签已删除', 'success');
          const sid = String(id);
          this.selectedBookmarks = (this.selectedBookmarks || []).map((x) => String(x)).filter((x) => x !== sid);
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast('删除失败', 'error');
        }
      } catch (error) {
        this.showToast('删除失败', 'error');
      }
    },

    async batchDelete() {
      const idsToDelete = Array.isArray(arguments[0]) ? arguments[0] : this.selectedBookmarks;
      const confirmMsg = typeof arguments[1] === 'string' ? arguments[1] : `确认删除选中的 ${idsToDelete.length} 个书签？`;
      if (idsToDelete.length === 0) return;
      if (!await AppDialog.confirm(confirmMsg)) return;

      try {
        const params = new URLSearchParams();
        idsToDelete.forEach((id) => params.append('bookmark_ids[]', String(id)));
        const response = await fetch('/bookmarks/batch-delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });

        if (response.ok) {
          this.showToast(`已删除 ${idsToDelete.length} 个书签`, 'success');
          const del = new Set(idsToDelete.map((x) => String(x)));
          this.selectedBookmarks = (this.selectedBookmarks || []).map((x) => String(x)).filter((x) => !del.has(x));
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast('批量删除失败', 'error');
        }
      } catch (error) {
        this.showToast('批量删除失败', 'error');
      }
    },

    async deleteCurrentPage() {
      const ids = this.displayBookmarks.map((b) => String(b.id));
      if (ids.length === 0) return;
      await this.batchDelete(ids, '确认删除当前页所有书签？');
    },

    async deleteAllBookmarks() {
      if (!await AppDialog.confirm('确认删除全部书签？该操作不可恢复。')) return;
      try {
        const res = await fetch('/api/bookmarks/delete-all', { method: 'POST', headers: { 'Accept': 'application/json' } });
        const data = await res.json();
        if (res.ok) {
          this.showToast('已删除全部书签', 'success');
          this.selectedBookmarks = [];
          this.page = 1;
          await this.loadBookmarks();
          await this.loadCategories();
        } else {
          this.showToast((data && data.error) ? data.error : '删除全部失败', 'error');
        }
      } catch {
        this.showToast('删除全部失败', 'error');
      }
    },

    toggleAll(event) {
      const pageIds = this.displayBookmarks.map((b) => String(b.id));
      const set = new Set((this.selectedBookmarks || []).map((x) => String(x)));
      if (event.target.checked) {
        pageIds.forEach((id) => set.add(id));
      } else {
        pageIds.forEach((id) => set.delete(id));
      }
      this.selectedBookmarks = Array.from(set);
    },

    get allSelected() {
      if (!this.displayBookmarks.length) return false;
      const set = new Set((this.selectedBookmarks || []).map((x) => String(x)));
      return this.displayBookmarks.every((b) => set.has(String(b.id)));
    },

    openCheckModalForSelected() {
      this.ensureSelectionContext();
      if (!this.selectedBookmarks || this.selectedBookmarks.length === 0) {
        this.showToast('请先勾选要检查的书签', 'error');
        return;
      }
      this.checkOptions.scope = 'selected';
      this.showCheckModal = true;
    },

    openCheckModal() {
      this.ensureSelectionContext();
      this.showCheckModal = true;
    },

    closeCheckModal() {
      this.showCheckModal = false;
      try {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
      } catch {
      }
      this.checkJobId = null;
      this.checkJobDone = false;
      this.jobType = 'check';
      this.checkStats = { processed: 0, total: 0, inserted: 0, failed: 0 };
      this.checkProgress = 0;
    },

    async startCheck() {
      try {
        this.ensureSelectionContext();
        const params = new URLSearchParams();
        params.append('scope', this.checkOptions.scope);
        params.append('retries', this.checkOptions.retries);
        params.append('retry_delay_ms', this.checkOptions.retry_delay_ms);

        if (this.checkOptions.scope === 'selected') {
          if (!this.selectedBookmarks || this.selectedBookmarks.length === 0) {
            this.showToast('请先勾选要检查的书签', 'error');
            return;
          }
          this.selectedBookmarks.forEach((id) => params.append('bookmark_ids[]', String(id)));
        }

        if (this.checkOptions.scope === 'category') {
          if (this.currentCategory === null) {
            this.showToast('请先选择一个分类再检查', 'error');
            return;
          }
          params.append('category', String(this.currentCategory));
        }

        if (this.checkOptions.scope === 'categories') {
          if (!this.checkOptions.categoryIds || this.checkOptions.categoryIds.length === 0) {
            this.showToast('请先选择分类', 'error');
            return;
          }
          params.append('category_ids', this.checkOptions.categoryIds.join(','));
        }

        const response = await fetch('/api/check/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
          },
          body: params.toString(),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok || !data || !data.jobId) {
          this.showToast((data && data.error) ? data.error : '启动检查失败', 'error');
          return;
        }

        this.jobType = 'check';
        this.checkJobId = data.jobId;
        this.lastJobId = data.jobId;
        this.lastJobType = 'check';
        this.persistLastJob();
        this.showCheckModal = true;
        this.subscribeToJobProgress();
      } catch (error) {
        this.showToast('启动检查失败', 'error');
      }
    },

    subscribeToJobProgress() {
      if (this.eventSource) {
        this.eventSource.close();
      }

      const jobId = this.checkJobId;
      if (!jobId) return;

      this.eventSource = new EventSource(`/jobs/${jobId}/events`);

      this.eventSource.onerror = () => {
        try {
          if (this.eventSource) this.eventSource.close();
        } catch {
        }
        this.eventSource = null;
        this.showToast('任务连接已断开，可在任务列表查看', 'error');
      };

      this.eventSource.onmessage = (event) => {
        try {
          const job = JSON.parse(event.data);
          const stats = {
            processed: job.processed,
            total: job.total,
            inserted: job.inserted,
            failed: job.failed
          };
          const progress = job.total > 0 ? Math.floor((job.processed / job.total) * 100) : 0;

          this.checkStats = stats;
          this.checkProgress = progress;

          // 当正在观看导入任务，且其消息提示已创建检查任务时，自动切换到检查任务以继续展示进度
          if (this.jobType === 'import' && typeof job.message === 'string') {
            const m = job.message.match(/已创建检查任务：([0-9a-f\-]{10,})/i);
            if (m && m[1]) {
              this.eventSource.close();
              this.checkJobId = m[1];
              this.jobType = 'check';
              this.lastJobId = m[1];
              this.lastJobType = 'check';
              this.persistLastJob();
              this.showToast('已切换为检查任务进度', 'info');
              this.subscribeToJobProgress();
              return;
            }
          }

          if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
            this.eventSource.close();
            this.eventSource = null;
            this.showToast('任务完成', job.status === 'done' ? 'success' : job.status === 'canceled' ? 'info' : 'error');
            this.checkJobDone = true;
            this.loadBookmarks();
            this.loadCategories();
          }
        } catch (error) {
          console.error('Failed to parse SSE data:', error);
        }
      };
    },

    subscribeToImportProgress() {
      if (this.eventSource) {
        this.eventSource.close();
      }

      const jobId = this.importJobId;
      if (!jobId) return;

      this.eventSource = new EventSource(`/jobs/${jobId}/events`);

      this.eventSource.onerror = () => {
        try {
          if (this.eventSource) this.eventSource.close();
        } catch { }
        this.eventSource = null;
      };

      this.eventSource.onmessage = (event) => {
        try {
          const job = JSON.parse(event.data);
          this.importStats = {
            processed: job.processed,
            total: job.total,
            inserted: job.inserted,
            failed: job.failed
          };
          this.importProgress = job.total > 0 ? Math.floor((job.processed / job.total) * 100) : 0;

          // 当导入任务消息提示已创建检查任务时，自动切换到检查任务
          if (typeof job.message === 'string') {
            const m = job.message.match(/已创建检查任务：([0-9a-f\-]{10,})/i);
            if (m && m[1]) {
              this.eventSource.close();
              this.checkJobId = m[1];
              this.jobType = 'check';
              this.lastJobId = m[1];
              this.lastJobType = 'check';
              this.persistLastJob();
              this.showImportProgressModal = false;
              this.showCheckModal = true;
              this.checkStats = { processed: 0, total: 0, inserted: 0, failed: 0 };
              this.checkProgress = 0;
              this.subscribeToJobProgress();
              this.showToast('导入完成，开始检查书签', 'info');
              return;
            }
          }

          if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
            this.eventSource.close();
            this.eventSource = null;
            this.showToast(job.status === 'done' ? '导入完成' : job.status === 'canceled' ? '导入已取消' : '导入失败', job.status === 'done' ? 'success' : job.status === 'canceled' ? 'info' : 'error');

            setTimeout(() => {
              this.importJobId = null;
              this.showImportProgressModal = false;
              this.loadBookmarks();
              this.loadCategories();
            }, 1500);
          }
        } catch (error) {
          console.error('Failed to parse import SSE data:', error);
        }
      };
    },

    closeImportProgressModal() {
      this.showImportProgressModal = false;
    },

    async cancelImportJob() {
      if (!this.importJobId) return;
      try {
        await fetch(`/api/jobs/${this.importJobId}/cancel`, { method: 'POST' });
        this.showToast('正在取消导入任务', 'info');
      } catch { }
    },

    async startImport(formEl) {
      try {
        if (!formEl) return;
        try {
          const fileInput = formEl.querySelector('input[type="file"][name="file"]');
          if (!fileInput || !fileInput.files || !fileInput.files[0]) {
            this.showToast('请选择要导入的文件', 'error');
            return;
          }
        } catch {
        }
        const formData = new FormData(formEl);
        const response = await fetch('/import', {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: formData
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          this.showToast((data && data.error) ? data.error : '导入启动失败', 'error');
          return;
        }
        if (data && data.jobId) {
          this.jobType = 'import';
          this.importJobId = data.jobId;
          this.importStats = { processed: 0, total: 0, inserted: 0, failed: 0 };
          this.importProgress = 0;
          this.lastJobId = data.jobId;
          this.lastJobType = 'import';
          this.persistLastJob();
          this.showImportProgressModal = true;
          this.subscribeToImportProgress();
          // 清空文件选择
          try {
            const fileInput = formEl.querySelector('input[type="file"][name="file"]');
            if (fileInput) fileInput.value = '';
          } catch { }
        } else {
          this.showToast('导入启动失败', 'error');
        }
      } catch (e) {
        this.showToast('导入失败', 'error');
      }
    },

    async startCheckSelected() {
      this.openCheckModalForSelected();
    },

    async loadTemplates() {
      try {
        const res = await fetch('/api/templates', { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) return;
        this.templates = data.templates || [];
        this.activeTemplate = this.templates.find(t => t.is_active === 1) || null;
      } catch { }
    },

    async applyTemplate(id) {
      if (this.templateApplying) return;
      this.templateApplying = true;
      try {
        const res = await fetch(`/api/templates/${id}/apply`, {
          method: 'POST', headers: { 'Accept': 'application/json' },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          this.showToast(data?.error || '应用模板失败', 'error');
          return;
        }
        await this.loadTemplates();
        await this.loadCategories();
        await this.loadBookmarks();
        this.showToast('模板已应用', 'success');
      } catch {
        this.showToast('应用模板失败', 'error');
      } finally {
        this.templateApplying = false;
      }
    },

    async createTemplate(name, tree) {
      try {
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, tree }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          this.showToast(data?.error || '创建模板失败', 'error');
          return null;
        }
        await this.loadTemplates();
        this.showToast('模板已创建', 'success');
        return data.template || null;
      } catch {
        this.showToast('创建模板失败', 'error');
        return null;
      }
    },

    async updateTemplate(id, patch) {
      try {
        const res = await fetch(`/api/templates/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          this.showToast(data?.error || '更新模板失败', 'error');
          return null;
        }
        await this.loadTemplates();
        this.showToast('模板已更新', 'success');
        return data.template || null;
      } catch {
        this.showToast('更新模板失败', 'error');
        return null;
      }
    },

    async deleteTemplate(id) {
      try {
        const res = await fetch(`/api/templates/${id}`, {
          method: 'DELETE', headers: { 'Accept': 'application/json' },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          this.showToast(data?.error || '删除模板失败', 'error');
          return;
        }
        await this.loadTemplates();
        this.showToast('模板已删除', 'success');
      } catch {
        this.showToast('删除模板失败', 'error');
      }
    },

    async resetPresetTemplate(id) {
      if (!await AppDialog.confirm('确定要重置此预置模板？所有书签将变为未分类，分类树将恢复为模板默认状态。')) return;
      try {
        const res = await fetch(`/api/templates/${id}/reset`, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          this.showToast(data?.error || '重置模板失败', 'error');
          return;
        }
        await this.loadTemplates();
        await this.loadCategories();
        await this.loadBookmarks();
        this.showToast('模板已重置', 'success');
      } catch {
        this.showToast('重置模板失败', 'error');
      }
    },

    async openTemplateEditor(tplId) {
      try {
        const res = await fetch(`/api/templates/${tplId}`, { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.template) {
          this.showToast('加载模板详情失败', 'error');
          return;
        }
        this.templateEditTarget = data.template;
        this.templateEditName = data.template.name;
        this.templateEditTree = (data.template.tree || []).map(n => ({
          name: n.name,
          children: (n.children || []).map(c => ({ name: c.name })),
        }));
        this.templateEditSourceId = null;
        this.templateEditSnapshot = JSON.stringify({ name: this.templateEditName, tree: this.templateEditTree });
        this.showTemplateEditModal = true;
      } catch {
        this.showToast('加载模板详情失败', 'error');
      }
    },

    async copyTemplateAsCustom(tplId) {
      try {
        const res = await fetch(`/api/templates/${tplId}`, { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.template) {
          this.showToast('加载模板详情失败', 'error');
          return;
        }
        this.templateEditTarget = null;
        this.templateEditName = data.template.name + ' (自定义)';
        this.templateEditTree = (data.template.tree || []).map(n => ({
          name: n.name,
          children: (n.children || []).map(c => ({ name: c.name })),
        }));
        this.showTemplateEditModal = true;
      } catch {
        this.showToast('加载模板详情失败', 'error');
      }
    },

    openNewTemplateEditor() {
      this.templateEditTarget = null;
      this.templateEditName = '';
      this.templateEditTree = [];
      this.templateEditSourceId = null;
      this.templateEditSnapshot = JSON.stringify({ name: '', tree: [] });
      this.showTemplateEditModal = true;
    },

    hasUnsavedTemplateChanges() {
      if (!this.templateEditSnapshot) return false;
      return JSON.stringify({ name: this.templateEditName, tree: this.templateEditTree }) !== this.templateEditSnapshot;
    },

    async loadPresetTreeForEdit(sourceId) {
      if (!sourceId) {
        this.templateEditTree = [];
        return;
      }
      try {
        const res = await fetch(`/api/templates/${sourceId}`, { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.template?.tree) {
          this.templateEditTree = data.template.tree.map(n => ({
            name: n.name,
            children: (n.children || []).map(c => ({ name: c.name })),
          }));
        }
      } catch {
        this.showToast('加载预置模板失败', 'error');
      }
    },

    addTemplateTreeNode(parentIndex) {
      if (parentIndex === undefined) {
        this.templateEditTree.push({ name: '新分类', children: [] });
      } else {
        if (!this.templateEditTree[parentIndex].children) this.templateEditTree[parentIndex].children = [];
        this.templateEditTree[parentIndex].children.push({ name: '新子分类' });
      }
    },

    removeTemplateTreeNode(parentIndex, childIndex) {
      if (childIndex === undefined) {
        this.templateEditTree.splice(parentIndex, 1);
      } else {
        this.templateEditTree[parentIndex].children.splice(childIndex, 1);
      }
    },

    async saveTemplateEdit() {
      const name = this.templateEditName.trim();
      if (!name) { this.showToast('模板名称不能为空', 'error'); return; }
      let result;
      if (this.templateEditTarget) {
        result = await this.updateTemplate(this.templateEditTarget.id, { name, tree: this.templateEditTree });
      } else {
        result = await this.createTemplate(name, this.templateEditTree);
      }
      if (result) {
        this.showTemplateEditModal = false;
      }
    },

    promptClassifyBatch(bookmarkIds) {
      if (!this.isAIConfigured()) {
        this.showToast('请先在设置页配置 AI（Base URL、API Key、Model）', 'error');
        return;
      }
      if (!this.activeTemplate) {
        this.showToast('请先选择分类模板', 'error');
        return;
      }
      if (!bookmarkIds || bookmarkIds.length === 0) {
        this.showToast('没有可分类的书签', 'error');
        return;
      }
      this.classifyBatchIds = bookmarkIds;
      this.classifyBatchSize = 20;
      this.showBatchSizeModal = true;
    },

    async startClassifyBatch(bookmarkIds, batchSize) {
      this.showBatchSizeModal = false;
      try {
        const res = await fetch('/api/ai/classify-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookmark_ids: bookmarkIds, batch_size: batchSize }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          if (res.status === 409) {
            this.showToast('有正在执行的 AI 分类任务，请等待完成后再试', 'error');
            return;
          }
          this.showToast(data?.error || '启动 AI 分类失败', 'error');
          return;
        }
        this.organizePlan = { id: data.planId, job_id: data.jobId };
        this.organizePhase = 'assigning';
        this.organizeProgress = { batches_done: 0, batches_total: 0, failed_batch_ids: [], needs_review_count: 0 };
        this.showAIOrganizeModal = true;
        this.pollOrganizeProgress();
        this.showToast(`AI 分类已启动 (${bookmarkIds.length} 个书签)`, 'info');
      } catch {
        this.showToast('启动 AI 分类失败', 'error');
      }
    },

    openAIOrganizeModal() {
      if (!this.isAIConfigured()) {
        this.showToast('请先在设置页配置 AI（Base URL、API Key、Model）', 'error');
        return;
      }
      this.organizeScope = 'all';
      this.organizeScopeCategoryId = '';
      this.organizePlan = null;
      this.organizePhase = 'idle';
      this.organizeDiff = null;
      this.organizeConflicts = [];
      this.organizeEmptyCategories = [];
      this.organizeAppliedCount = 0;
      this.loadPendingPlans();
      this.showAIOrganizeModal = true;
    },

    isAIConfigured() {
      return this.settings &&
        this.settings.ai_base_url &&
        this.settings.ai_base_url.trim() !== '' &&
        this.settings.ai_api_key &&
        this.settings.ai_api_key.trim() !== '' &&
        this.settings.ai_model &&
        this.settings.ai_model.trim() !== '';
    },

    openExportModal() {
      this.exportScope = 'all';
      this.exportFormat = 'html';
      this.showExportModal = true;
    },

    openExportSelectedCategories() {
      this.exportScope = 'selected';
      this.exportFormat = 'html';
      this.showExportModal = true;
    },

    async checkSelectedCategories() {
      if (this.selectedCategories.length === 0) {
        this.showToast('请先选择分类', 'error');
        return;
      }
      this.checkOptions.scope = 'categories';
      this.checkOptions.categoryIds = [...this.selectedCategories];
      this.showCheckModal = true;
    },

    closeExportModal() {
      this.showExportModal = false;
    },

    getExportUrl() {
      let url = '/export';
      const params = new URLSearchParams();

      if (this.exportFormat === 'json') {
        params.append('format', 'json');
      }

      if (this.exportScope === 'uncategorized') {
        params.append('scope', 'uncategorized');
      } else if (this.exportScope === 'selected' && this.selectedCategories.length > 0) {
        params.append('scope', 'categories');
        params.append('categoryIds', this.selectedCategories.join(','));
      }

      const queryString = params.toString();
      return queryString ? `${url}?${queryString}` : url;
    },

    async startOrganize() {
      if (this.organizeScope === 'category' && !this.organizeScopeCategoryId) {
        this.showToast('请选择一个分类', 'error');
        return;
      }
      try {
        this.organizePhase = 'assigning';
        const scope = this.organizeScope === 'category' ? 'category:' + this.organizeScopeCategoryId : this.organizeScope;
        const res = await fetch('/api/ai/organize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope,
            batch_size: this.classifyBatchSize || 20,
            template_id: this.activeTemplate?.id || null
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          if (res.status === 409 && data?.activePlanId) {
            await this.recoverActivePlan(data.activePlanId);
            return;
          }
          this.showToast(data?.error || '启动整理失败', 'error');
          this.organizePhase = 'idle';
          return;
        }
        this.organizePlan = { id: data.planId, job_id: data.jobId };
        this.organizeProgress = { batches_done: 0, batches_total: 0, failed_batch_ids: [], needs_review_count: 0 };
        this.pollOrganizeProgress();
      } catch {
        this.showToast('启动整理失败', 'error');
        this.organizePhase = 'idle';
      }
    },

    async recoverActivePlan(planId) {
      try {
        let res = await fetch(planId ? ('/api/ai/organize/' + encodeURIComponent(planId)) : '/api/ai/organize/active');
        let data = await res.json().catch(() => null);
        if (planId && (!res.ok || !data)) {
          res = await fetch('/api/ai/organize/active');
          data = await res.json().catch(() => null);
        }
        if (!res.ok || !data || data.active === null) {
          this.showToast('未找到活跃计划', 'error');
          this.organizePhase = 'idle';
          return;
        }
        this.organizePlan = data;
        this.organizeProgress = {
          batches_done: data.batches_done || 0,
          batches_total: data.batches_total || 0,
          failed_batch_ids: data.failed_batch_ids || [],
          needs_review_count: data.needs_review_count || 0,
        };
        this.organizeDiff = data.diff || null;
        this.showToast('已有进行中的整理计划', 'info');
        if (data.status === 'assigning') { this.organizePhase = 'assigning'; this.pollOrganizeProgress(); }
        else if (data.status === 'preview') { this.organizePhase = 'preview'; }
        else if (data.status === 'applied') { this.organizePhase = 'applied'; }
        else if (data.status === 'failed') this.organizePhase = 'failed';
      } catch {
        this.showToast('恢复计划失败', 'error');
        this.organizePhase = 'idle';
      }
    },

    async cancelAndRestart() {
      if (!this.organizePlan?.id) return;
      try {
        const res = await fetch('/api/ai/organize/' + this.organizePlan.id + '/cancel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
          this.organizePlan = null;
          this.organizePhase = 'idle';
          await this.startOrganize();
        } else {
          this.showToast('取消计划失败', 'error');
        }
      } catch {
        this.showToast('取消计划失败', 'error');
      }
    },

    async loadOrganizePlan() {
      if (!this.organizePlan?.id) return;
      try {
        const res = await fetch('/api/ai/organize/' + this.organizePlan.id);
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          this.organizePlan = data;
          this.organizeProgress = {
            batches_done: data.batches_done || 0,
            batches_total: data.batches_total || 0,
            failed_batch_ids: data.failed_batch_ids || [],
            needs_review_count: data.needs_review_count || 0,
          };
          if (data.diff) {
            if (data.diff.empty_categories) data.diff.empty_categories = data.diff.empty_categories.map(e => ({ ...e, action: e.action || 'keep' }));
            this.organizeDiff = data.diff;
          }
          if (data.status === 'preview') {
            this.organizePhase = 'preview';
          } else if (data.status === 'applied') {
            this.organizePhase = 'applied';
          } else if (data.status === 'assigning') {
            this.organizePhase = 'assigning';
          } else if (data.status === 'failed') {
            this.organizePhase = 'failed';
          }
        }
      } catch { }
    },

    pollOrganizeProgress() {
      if (this.organizePollTimer) clearInterval(this.organizePollTimer);
      this.organizePollTimer = setInterval(async () => {
        await this.loadOrganizePlan();
        if (this.organizePhase !== 'assigning') {
          clearInterval(this.organizePollTimer);
          this.organizePollTimer = null;
        }
      }, 3000);
    },

    async applyOrganizePlan() {
      if (!this.organizePlan?.id) return;
      try {
        const res = await fetch('/api/ai/organize/' + this.organizePlan.id + '/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          this.organizeAppliedCount = data.applied_count || 0;
          this.organizeConflicts = (data.conflicts || []).map(c => ({ ...c, action: 'skip' }));
          this.organizeEmptyCategories = (data.empty_categories || []).map(e => ({ ...e, action: 'keep' }));
          if (this.organizeConflicts.length > 0 || this.organizeEmptyCategories.length > 0) {
            this.organizeResolving = true;
          } else {
            this.organizePhase = 'applied';
            this.showToast('整理已应用，共移动 ' + (data.applied_count || 0) + ' 个书签', 'success');
            this.loadBookmarks();
            this.loadCategories();
          }
        } else {
          this.showToast(data?.error || '应用失败', 'error');
        }
      } catch {
        this.showToast('应用失败', 'error');
      }
    },

    async resolveAndApply() {
      if (!this.organizePlan?.id) return;
      const conflicts = this.organizeConflicts.map(c => ({ bookmark_id: c.bookmark_id, action: c.action || 'skip' }));
      const emptyCats = this.organizeEmptyCategories.map(e => ({ id: e.id, action: e.action || 'keep' }));
      try {
        const res = await fetch('/api/ai/organize/' + this.organizePlan.id + '/apply/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conflicts, empty_categories: emptyCats })
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          this.organizePhase = 'applied';
          const totalApplied = (data.applied_count || 0) + (this.organizeAppliedCount || 0);
          this.showToast('整理已应用，共移动 ' + totalApplied + ' 个书签', 'success');
          this.organizeAppliedCount = 0;
          this.loadBookmarks();
          this.loadCategories();
          await this.loadOrganizePlan();
        } else {
          this.showToast(data?.error || '应用失败', 'error');
        }
      } catch {
        this.showToast('应用失败', 'error');
      }
    },

    async rollbackOrganize() {
      if (!this.organizePlan?.id) return;
      try {
        const res = await fetch('/api/ai/organize/' + this.organizePlan.id + '/rollback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          this.showToast('已回滚', 'success');
          this.loadBookmarks();
          this.loadCategories();
          this.closeOrganizeModal();
        } else {
          this.showToast(data?.error || '回滚失败', 'error');
        }
      } catch {
        this.showToast('回滚失败', 'error');
      }
    },

    async cancelOrganize() {
      if (!this.organizePlan?.id) return;
      try {
        await fetch('/api/ai/organize/' + this.organizePlan.id + '/cancel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        this.showToast('已取消', 'info');
        this.closeOrganizeModal();
      } catch {
        this.showToast('取消失败', 'error');
      }
    },

    async retryOrganize() {
      if (!this.organizePlan?.id) return;
      try {
        const res = await fetch('/api/ai/organize/' + this.organizePlan.id + '/retry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          this.organizePhase = 'assigning';
          this.pollOrganizeProgress();
        }
      } catch {
        this.showToast('重试失败', 'error');
      }
    },

    closeOrganizeModal() {
      this.showAIOrganizeModal = false;
      if (this.organizePollTimer) { clearInterval(this.organizePollTimer); this.organizePollTimer = null; }
      this.organizePlan = null;
      this.organizePhase = 'idle';
      this.organizeResolving = false;
      this.organizeDiffExpanded = {};
    },

    getDiffMovesByCategory() {
      if (!this.organizeDiff?.moves) return [];
      const map = {};
      for (const m of this.organizeDiff.moves) {
        const key = m.to_category || '未分类';
        if (!map[key]) map[key] = { category: key, bookmarks: [] };
        map[key].bookmarks.push(m);
      }
      return Object.values(map).sort((a, b) => b.bookmarks.length - a.bookmarks.length);
    },

    toggleDiffCategory(cat) {
      this.organizeDiffExpanded[cat] = !this.organizeDiffExpanded[cat];
    },

    getNeedsReviewBookmarks() {
      if (!this.organizePlan?.assignments) return [];
      return this.organizePlan.assignments.filter(a => a.status === 'needs_review');
    },

    canRollback() {
      if (!this.organizePlan?.applied_at) return false;
      const appliedAt = new Date(this.organizePlan.applied_at).getTime();
      return (Date.now() - appliedAt) < 24 * 60 * 60 * 1000;
    },

    async loadPendingPlans() {
      try {
        const res = await fetch('/api/ai/organize/pending');
        const data = await res.json().catch(() => null);
        this.pendingPlans = (data?.plans || []);
      } catch { this.pendingPlans = []; }
    },

    viewPendingPlan(plan) {
      if (plan.job_id) {
        window.location.href = '/jobs/' + plan.job_id;
      }
    },

    statusIconClass(status) {
      return status === 'ok' ? 'bg-emerald-500' : status === 'fail' ? 'bg-rose-500' : 'bg-slate-300';
    },

    statusText(status) {
      return status === 'ok' ? '正常' : status === 'fail' ? '访问失败' : '未检查';
    },

    async updateBookmarkStatus(bookmarkId, newStatus) {
      try {
        const response = await fetch(`/api/bookmarks/${bookmarkId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: newStatus }),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          this.showToast((data && data.error) ? data.error : '更新状态失败', 'error');
          return;
        }

        // 更新本地数据
        const bookmark = this.bookmarks.find(b => b.id === bookmarkId);
        if (bookmark) {
          bookmark.check_status = newStatus;
          bookmark.updated_at = new Date().toISOString();
        }

        this.showToast('状态已更新', 'success');
      } catch (error) {
        this.showToast('更新状态失败', 'error');
      }
    },

    async toggleSkipCheck(bookmark) {
      try {
        const newSkipCheck = !bookmark.skip_check;
        const response = await fetch(`/api/bookmarks/${bookmark.id}/skip-check`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ skip_check: newSkipCheck }),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          this.showToast((data && data.error) ? data.error : '更新失败', 'error');
          return;
        }

        // 更新本地数据
        bookmark.skip_check = newSkipCheck;
        this.showToast(newSkipCheck ? '已设置为忽略检查' : '已取消忽略检查', 'success');
      } catch (error) {
        this.showToast('更新失败', 'error');
      }
    },

    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm shadow-lg transition-all duration-300 ${type === 'success' ? 'bg-emerald-500 text-white' :
        type === 'error' ? 'bg-rose-500 text-white' :
          'bg-slate-700 text-white'
        }`;
      toast.textContent = message;
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';

      document.body.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    },

  };
}
