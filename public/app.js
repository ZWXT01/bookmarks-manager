// Toast notification system
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm shadow-lg transition-all duration-300 ${
    type === 'success' ? 'bg-emerald-500 text-white' :
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
}

// Handle category form submission
function setupCategoryForm() {
  const form = document.getElementById('category-form');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    submitBtn.disabled = true;
    submitBtn.textContent = '添加中...';
    
    try {
      const response = await fetch('/categories', {
        method: 'POST',
        body: formData
      });
      
      if (response.redirected) {
        const url = new URL(response.url);
        const msg = url.searchParams.get('msg');
        const err = url.searchParams.get('err');
        
        if (msg) {
          showToast(decodeURIComponent(msg), 'success');
          form.reset();
          setTimeout(() => window.location.reload(), 500);
        } else if (err) {
          showToast(decodeURIComponent(err), 'error');
        }
      }
    } catch (error) {
      showToast('操作失败，请重试', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// Handle bookmark form submission
function setupBookmarkForm() {
  const form = document.getElementById('bookmark-form');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    submitBtn.disabled = true;
    submitBtn.textContent = '添加中...';
    
    try {
      const response = await fetch('/bookmarks', {
        method: 'POST',
        body: formData
      });
      
      if (response.redirected) {
        const url = new URL(response.url);
        const msg = url.searchParams.get('msg');
        const err = url.searchParams.get('err');
        
        if (msg) {
          showToast(decodeURIComponent(msg), 'success');
          form.reset();
          setTimeout(() => window.location.reload(), 500);
        } else if (err) {
          showToast(decodeURIComponent(err), 'error');
        }
      }
    } catch (error) {
      showToast('操作失败，请重试', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// Handle import form submission
function setupImportForm() {
  const form = document.getElementById('import-form');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    const fileInput = form.querySelector('input[type="file"]');
    
    if (!fileInput.files.length) {
      showToast('请选择要导入的文件', 'error');
      return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = '上传中...';
    
    try {
      const response = await fetch('/import', {
        method: 'POST',
        body: formData
      });
      
      if (response.redirected) {
        showToast('导入任务已创建，正在跳转...', 'success');
        setTimeout(() => window.location.href = response.url, 500);
      } else {
        const url = new URL(response.url);
        const err = url.searchParams.get('err');
        if (err) {
          showToast(decodeURIComponent(err), 'error');
        }
      }
    } catch (error) {
      showToast('上传失败，请重试', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// Initialize all forms
document.addEventListener('DOMContentLoaded', () => {
  setupCategoryForm();
  setupBookmarkForm();
  setupImportForm();
});
