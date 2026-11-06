(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png"]);

  // 匯入檔案獨立保存，不放進 appState，也不直接改動表單或經費資料。
  const documentState = {
    applicationFiles: [],
    expenseFiles: [],
    isProcessing: false
  };

  window.documentImportState = documentState;

  const getExtension = (fileName) => {
    const parts = String(fileName || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  };

  const isSupportedFile = (file) => {
    const extension = getExtension(file.name);
    return allowedExtensions.has(extension) && file.size > 0;
  };

  const isDuplicate = (files, candidate) => files.some((file) =>
    file.name === candidate.name &&
    file.size === candidate.size &&
    file.lastModified === candidate.lastModified
  );

  const formatCount = (count) => count > 0 ? `${count} 個檔案` : "尚未選擇";

  function renderFileList(type) {
    const isApplication = type === "application";
    const files = isApplication
      ? documentState.applicationFiles
      : documentState.expenseFiles;
    const list = $(isApplication ? "applicationFileList" : "expenseFileList");
    const count = $(isApplication ? "applicationFileCount" : "expenseFileCount");

    if (!list || !count) return;

    count.textContent = formatCount(files.length);
    list.replaceChildren();

    if (files.length === 0) {
      const empty = document.createElement("li");
      empty.className = "import-empty-files";
      empty.textContent = "尚未選擇檔案";
      list.appendChild(empty);
      return;
    }

    files.forEach((file, index) => {
      const item = document.createElement("li");
      item.className = "import-file-item";

      const name = document.createElement("span");
      name.className = "import-file-name";
      name.textContent = file.name;
      name.title = file.name;

      const removeButton = document.createElement("button");
      removeButton.className = "import-remove-file-btn";
      removeButton.type = "button";
      removeButton.textContent = "移除";
      removeButton.setAttribute("aria-label", `移除檔案：${file.name}`);
      removeButton.addEventListener("click", () => {
        files.splice(index, 1);
        renderFileList(type);
      });

      item.append(name, removeButton);
      list.appendChild(item);
    });
  }

  function addSelectedFiles(type, selectedFiles) {
    const files = type === "application"
      ? documentState.applicationFiles
      : documentState.expenseFiles;

    let addedCount = 0;
    let unsupportedCount = 0;
    let duplicateCount = 0;

    Array.from(selectedFiles).forEach((file) => {
      if (!isSupportedFile(file)) {
        unsupportedCount += 1;
        return;
      }

      if (isDuplicate(files, file)) {
        duplicateCount += 1;
        return;
      }

      files.push(file);
      addedCount += 1;
    });

    renderFileList(type);

    const messages = [];
    if (addedCount) messages.push(`已加入 ${addedCount} 個檔案`);
    if (duplicateCount) messages.push(`略過 ${duplicateCount} 個重複檔案`);
    if (unsupportedCount) messages.push(`略過 ${unsupportedCount} 個不支援或空白檔案`);

    const notice = $("importNotice");
    if (notice && messages.length) {
      const detail = document.createElement("span");
      detail.textContent = messages.join("；");
      const oldDetail = notice.querySelector(".import-selection-feedback");
      if (oldDetail) oldDetail.remove();
      detail.className = "import-selection-feedback";
      notice.appendChild(detail);
    }
  }

  function openImportModal() {
    const backdrop = $("importModalBackdrop");
    if (!backdrop) return;
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    $("closeImportModalBtn")?.focus();
  }

  function closeImportModal() {
    if (documentState.isProcessing) return;
    const backdrop = $("importModalBackdrop");
    if (!backdrop) return;
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    $("importFilesBtn")?.focus();
  }

  function clearAllFiles() {
    if (documentState.isProcessing) return;

    documentState.applicationFiles = [];
    documentState.expenseFiles = [];

    const applicationInput = $("applicationFilesInput");
    const expenseInput = $("expenseFilesInput");
    if (applicationInput) applicationInput.value = "";
    if (expenseInput) expenseInput.value = "";

    renderFileList("application");
    renderFileList("expense");

    const notice = $("importNotice");
    if (notice) {
      const feedback = notice.querySelector(".import-selection-feedback");
      if (feedback) feedback.remove();
    }
  }

  function initialize() {
    $("importFilesBtn")?.addEventListener("click", openImportModal);
    $("closeImportModalBtn")?.addEventListener("click", closeImportModal);
    $("cancelImportModalBtn")?.addEventListener("click", closeImportModal);
    $("clearImportFilesBtn")?.addEventListener("click", clearAllFiles);

    $("applicationFilesInput")?.addEventListener("change", (event) => {
      addSelectedFiles("application", event.target.files || []);
      // 清空 input，讓使用者之後仍可再次選取同一個檔案。
      event.target.value = "";
    });

    $("expenseFilesInput")?.addEventListener("change", (event) => {
      addSelectedFiles("expense", event.target.files || []);
      event.target.value = "";
    });

    $("importModalBackdrop")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeImportModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("importModalBackdrop")?.classList.contains("open")) {
        closeImportModal();
      }
    });

    renderFileList("application");
    renderFileList("expense");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
